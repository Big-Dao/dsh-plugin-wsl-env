//! Spike for ADR 0002: an EXEC/KILL event loop with per-request process groups.
//!
//! Scope of this spike (deliberately small):
//!   HELLO, PING, SHUTDOWN, SETENV, EXEC, KILL, FS.
//! Filesystem operations use the shell agent's v5 record and staging formats.
//!
//! It exists to answer two questions with real code: can a native loop keep
//! one command running while another finishes (the shell's serial stall), and
//! can a KILL/timeout take the request's whole process group without a second
//! wsl.exe or USR1?
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, Read, Seek, SeekFrom, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

mod sha256;
use std::time::{Duration, Instant};

const SIGTERM: i32 = 15;
const SIGKILL: i32 = 9;

extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
    fn fcntl(fd: i32, command: i32, ...) -> i32;
    fn ioctl(fd: i32, request: u64, ...) -> i32;
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64_decode(text: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let mut buf: u32 = 0;
    let mut bits = 0u32;
    for &c in text.as_bytes() {
        if c == b'=' {
            break;
        }
        let value = match B64.iter().position(|&x| x == c) {
            Some(v) => v as u32,
            None => continue,
        };
        buf = (buf << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    out
}

fn b64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

type Out = Arc<Mutex<()>>;

struct ActiveRequest {
    cancelled: Arc<AtomicBool>,
    pgid: Option<i32>,
}

type Active = Arc<Mutex<HashMap<String, ActiveRequest>>>;

struct RequestGuard {
    active: Active,
    id: String,
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        self.active.lock().unwrap().remove(&self.id);
    }
}

fn write_line(out: &Out, line: &str) {
    let _guard = out.lock().unwrap();
    let mut stdout = io::stdout().lock();
    let _ = stdout.write_all(line.as_bytes());
    let _ = stdout.write_all(b"\n");
    let _ = stdout.flush();
}

fn read_bounded<R: Read + AsRawFd>(mut reader: R, cap: usize, finished: Arc<AtomicBool>) -> (Vec<u8>, bool) {
    let fd = reader.as_raw_fd();
    let flags = unsafe { fcntl(fd, 3) };
    if flags < 0 || unsafe { fcntl(fd, 4, flags | 0x800) } < 0 {
        return (Vec::new(), false);
    }
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut cut = false;
    let mut remaining = None;
    loop {
        if remaining.is_none() && finished.load(Ordering::Acquire) {
            let mut available = 0i32;
            if unsafe { ioctl(fd, 0x541b, &mut available) } < 0 {
                break;
            }
            remaining = Some(available.max(0) as usize);
        }
        let limit = remaining.unwrap_or(chunk.len()).min(chunk.len());
        if limit == 0 {
            break;
        }
        match reader.read(&mut chunk[..limit]) {
            Ok(0) => break,
            Ok(n) => {
                if let Some(left) = remaining.as_mut() {
                    *left -= n;
                }
                if cap == 0 {
                    buffer.extend_from_slice(&chunk[..n]);
                } else if buffer.len() < cap {
                    // Once the budget is full the pipe is still DRAINED: a
                    // writer that blocks on a full pipe would hang the child
                    // (and the request) after the cut.
                    let take = n.min(cap - buffer.len());
                    buffer.extend_from_slice(&chunk[..take]);
                    if take < n {
                        cut = true;
                    }
                } else {
                    cut = true;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if finished.load(Ordering::Acquire) {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    (buffer, cut)
}

fn cancel_group(active: &Active, id: &str, pgid: i32) {
    {
        let requests = active.lock().unwrap();
        if requests.get(id).and_then(|request| request.pgid) != Some(pgid) {
            return;
        }
        unsafe { kill(-pgid, SIGTERM) };
    }
    let active = Arc::clone(active);
    let id = id.to_string();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(3000));
        if active.lock().unwrap().get(&id).and_then(|request| request.pgid) == Some(pgid) {
            unsafe { kill(-pgid, SIGKILL) };
        }
    });
}

fn exit_code(status: std::process::ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    status.code().unwrap_or_else(|| 128 + status.signal().unwrap_or(0))
}


fn reason_for(error: &std::io::Error) -> &'static str {
    match error.kind() {
        io::ErrorKind::NotFound => "notfound",
        io::ErrorKind::PermissionDenied => "perm",
        io::ErrorKind::AlreadyExists => "exists",
        _ => match error.raw_os_error() {
            Some(20) => "notdir",
            Some(40) => "loop",
            _ => "io",
        },
    }
}

fn fs_fail(out: &Out, id: &str, reason: &str, message: &str) {
    // The v5 convention puts the side channel in the RES's stderr field, as
    // the first line; the host's DistroFs parses it there. The process's own
    // stderr stays clean.
    let line = format!("dsh-fs|{reason}|{}\n", b64_encode(message.as_bytes()));
    write_line(out, &format!("RES|{id}|1||{}|0|0", b64_encode(line.as_bytes())));
}

fn stat_record(path: &str, follow: bool) -> Result<String, (String, String)> {
    let metadata = if follow { fs::metadata(path) } else { fs::symlink_metadata(path) };
    match metadata {
        Ok(m) => {
            let ft = m.file_type();
            let kind = if ft.is_file() {
                "f"
            } else if ft.is_dir() {
                "d"
            } else if ft.is_symlink() {
                "l"
            } else if ft.is_fifo() {
                "p"
            } else if ft.is_socket() {
                "s"
            } else if ft.is_block_device() {
                "b"
            } else if ft.is_char_device() {
                "c"
            } else {
                "o"
            };
            let mode = m.permissions().mode() & 0o7777;
            Ok(format!(
                "{}\t{:o}\t{}\t{}\t{}\t{}.{:09}\t{}.{:09}",
                kind,
                mode,
                m.size(),
                m.dev(),
                m.ino(),
                m.mtime(),
                m.mtime_nsec(),
                m.ctime(),
                m.ctime_nsec()
            ))
        }
        Err(error) => Err((
            reason_for(&error).to_string(),
            format!("cannot stat \"{path}\": {error}"),
        )),
    }
}

fn version_of(path: &str) -> Option<String> {
    let m = fs::symlink_metadata(path).ok()?;
    Some(format!(
        "{}:{}:{}:{}{:09}:{}{:09}",
        m.dev(),
        m.ino(),
        m.size(),
        m.mtime(),
        m.mtime_nsec(),
        m.ctime(),
        m.ctime_nsec()
    ))
}


fn list_records(directory: &str) -> Result<Vec<u8>, (String, String)> {
    let resolved = fs::canonicalize(directory).map_err(|error| {
        (reason_for(&error).to_string(), format!("cannot list \"{directory}\": {error}"))
    })?;
    let entries = fs::read_dir(&resolved).map_err(|error| {
        (reason_for(&error).to_string(), format!("cannot list \"{directory}\": {error}"))
    })?;
    let mut output = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| (reason_for(&error).to_string(), format!("cannot list \"{directory}\": {error}")))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            (reason_for(&error).to_string(), format!("cannot list \"{directory}\": {error}"))
        })?;
        let file_type = metadata.file_type();
        let kind = if file_type.is_file() {
            "f"
        } else if file_type.is_dir() {
            "d"
        } else if file_type.is_symlink() {
            "l"
        } else if file_type.is_fifo() {
            "p"
        } else if file_type.is_socket() {
            "s"
        } else if file_type.is_block_device() {
            "b"
        } else if file_type.is_char_device() {
            "c"
        } else {
            "o"
        };
        output.extend_from_slice(
            format!(
                "{}\t{}\t{}\t{}\t{}.{:09}\t{}.{:09}\t{}\0",
                kind,
                metadata.size(),
                metadata.dev(),
                metadata.ino(),
                metadata.mtime(),
                metadata.mtime_nsec(),
                metadata.ctime(),
                metadata.ctime_nsec(),
                path.to_string_lossy()
            )
            .as_bytes(),
        );
    }
    Ok(output)
}

fn resolve_path(path: &str) -> Result<String, (String, String)> {
    if let Ok(resolved) = fs::canonicalize(path) {
        return Ok(resolved.to_string_lossy().into_owned());
    }
    let mut current = Path::new(path).to_path_buf();
    let mut missing: Vec<String> = Vec::new();
    loop {
        match fs::canonicalize(&current) {
            Ok(resolved) => {
                if missing.iter().any(|part| part == "..") {
                    return Err((
                        "notfound".to_string(),
                        format!("cannot resolve \"{path}\": parent traversal crosses a missing directory"),
                    ));
                }
                let mut result = resolved.to_string_lossy().into_owned();
                for part in missing.iter().rev() {
                    if !result.ends_with('/') {
                        result.push('/');
                    }
                    result.push_str(part);
                }
                return Ok(result);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let Some(name) = current.file_name() else {
                    return Err((reason_for(&error).to_string(), format!("cannot resolve \"{path}\": {error}")));
                };
                missing.push(name.to_string_lossy().into_owned());
                if !current.pop() {
                    return Err((reason_for(&error).to_string(), format!("cannot resolve \"{path}\": {error}")));
                }
            }
            Err(error) => {
                return Err((reason_for(&error).to_string(), format!("cannot resolve \"{path}\": {error}")));
            }
        }
    }
}

fn create_staging(directory: &Path) -> io::Result<std::path::PathBuf> {
    let mut random = File::open("/dev/urandom")?;
    for _ in 0..16 {
        let mut bytes = [0u8; 16];
        random.read_exact(&mut bytes)?;
        let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let staging = directory.join(format!(".dsh-wsl-{}-{token}.tmpdir", std::process::id()));
        match fs::DirBuilder::new().mode(0o700).create(&staging) {
            Ok(()) => return Ok(staging),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "cannot allocate staging directory"))
}

fn handle_fs(
    id: String,
    op: String,
    args: Vec<Vec<u8>>,
    out: Out,
    fs_lock: Arc<Mutex<()>>,
    active: Active,
    cancelled: Arc<AtomicBool>,
) {
    let _guard = RequestGuard { active, id: id.clone() };
    let _serial = fs_lock.lock().unwrap();
    write_line(&out, &format!("ACK|{id}"));
    if cancelled.load(Ordering::Acquire) {
        fs_fail(&out, &id, "io", "request cancelled");
        return;
    }
    let text = |index: usize| -> String {
        args.get(index)
            .map(|v| String::from_utf8_lossy(v).into_owned())
            .unwrap_or_default()
    };
    match op.as_str() {
        "stat" | "lstat" => {
            let path = text(0);
            match stat_record(&path, op == "stat") {
                Ok(record) => write_line(&out, &format!("RES|{id}|0|{}||0|0", b64_encode(record.as_bytes()))),
                Err((reason, message)) => fs_fail(&out, &id, &reason, &message),
            }
        }
        "read" => {
            let path = text(0);
            let offset: u64 = text(1).parse().unwrap_or(0);
            let max: usize = text(2).parse().unwrap_or(0);
            match File::open(&path).and_then(|mut file| {
                file.seek(SeekFrom::Start(offset))?;
                let mut buffer = vec![0u8; max];
                let read = file.read(&mut buffer)?;
                buffer.truncate(read);
                Ok(buffer)
            }) {
                Ok(bytes) => write_line(&out, &format!("RES|{id}|0|{}||0|0", b64_encode(&bytes))),
                Err(error) => fs_fail(&out, &id, reason_for(&error), &format!("cannot read \"{path}\": {error}")),
            }
        }
        "write" => {
            let path = text(0);
            let mode = text(1);
            let publish = text(2);
            let expected = text(3);
            let content = args.get(4).cloned().unwrap_or_default();
            let target = Path::new(&path);
            let directory = target.parent().unwrap_or_else(|| Path::new("."));
            if !directory.is_dir() {
                if let Err(error) = fs::create_dir(directory) {
                    if !directory.is_dir() {
                        fs_fail(&out, &id, reason_for(&error), &format!("cannot write \"{path}\": {error}"));
                        return;
                    }
                }
            }
            let base = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if base.is_empty() {
                fs_fail(&out, &id, "notfound", "empty file name");
                return;
            }
            let staging = match create_staging(directory) {
                Ok(staging) => staging,
                Err(error) => {
                    fs_fail(&out, &id, reason_for(&error), &format!("cannot write \"{path}\": {error}"));
                    return;
                }
            };
            let temp = match (|| {
                let temp = staging.join("content");
                let mut file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(&temp)?;
                file.write_all(&content)?;
                file.sync_all()?;
                Ok(temp)
            })() {
                Ok(temp) => temp,
                Err(error) => {
                    let _ = fs::remove_dir_all(&staging);
                    fs_fail(&out, &id, reason_for(&error), &format!("cannot write \"{path}\": {error}"));
                    return;
                }
            };
            if mode != "-" {
                if let Ok(parsed) = u32::from_str_radix(&mode, 8) {
                    let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(parsed & 0o7777));
                }
            }
            if publish == "replace" && expected != "-" {
                let current = version_of(&path);
                if current.as_deref() != Some(expected.as_str()) {
                    let _ = fs::remove_dir_all(&staging);
                    fs_fail(&out, &id, "stale", &format!("cannot write \"{path}\": file changed since it was read"));
                    return;
                }
            }
            if cancelled.load(Ordering::Acquire) {
                let _ = fs::remove_dir_all(&staging);
                fs_fail(&out, &id, "io", "request cancelled");
                return;
            }
            if publish == "no-replace" {
                if fs::symlink_metadata(&path).is_ok() {
                    let _ = fs::remove_dir_all(&staging);
                    fs_fail(&out, &id, "exists", &format!("cannot write \"{path}\": it already exists"));
                    return;
                }
                if let Err(error) = fs::hard_link(&temp, &path) {
                    let _ = fs::remove_dir_all(&staging);
                    fs_fail(&out, &id, reason_for(&error), &format!("cannot write \"{path}\": {error}"));
                    return;
                }
            } else if let Err(error) = fs::rename(&temp, &path) {
                let _ = fs::remove_dir_all(&staging);
                fs_fail(&out, &id, reason_for(&error), &format!("cannot write \"{path}\": {error}"));
                return;
            }
            let _ = fs::remove_dir_all(&staging);
            write_line(&out, &format!("RES|{id}|0|||0|0"));
        }
        "list" => {
            let path = text(0);
            match list_records(&path) {
                Ok(records) => write_line(&out, &format!("RES|{id}|0|{}||0|0", b64_encode(&records))),
                Err((reason, message)) => fs_fail(&out, &id, &reason, &message),
            }
        }
        "realpath" => {
            let path = text(0);
            match resolve_path(&path) {
                Ok(resolved) => write_line(&out, &format!("RES|{id}|0|{}||0|0", b64_encode(resolved.as_bytes()))),
                Err((reason, message)) => fs_fail(&out, &id, &reason, &message),
            }
        }
        _ => write_line(&out, &format!("ERR|{id}|protocol|{}", b64_encode(format!("FS op not in this spike: {op}").as_bytes()))),
    }
}

fn handle_exec(
    id: String,
    cwd: String,
    argv: Vec<String>,
    timeout_secs: u64,
    cap: usize,
    envs: Arc<Mutex<HashMap<String, String>>>,
    active: Active,
    cancelled: Arc<AtomicBool>,
    out: Out,
) {
    let _guard = RequestGuard { active: Arc::clone(&active), id: id.clone() };
    write_line(&out, &format!("ACK|{id}"));
    if cancelled.load(Ordering::Acquire) {
        write_line(&out, &format!("RES|{id}|143|||0|0"));
        return;
    }
    if argv.is_empty() {
        write_line(&out, &format!("ERR|{id}|protocol|{}", b64_encode(b"empty argv")));
        return;
    }
    let mut command = Command::new(&argv[0]);
    command.args(&argv[1..]);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.process_group(0);
    if !cwd.is_empty() {
        command.current_dir(&cwd);
    }
    let pairs: Vec<(String, String)> = envs.lock().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    command.envs(pairs);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            write_line(&out, &format!("ERR|{id}|spawn|{}", b64_encode(error.to_string().as_bytes())));
            return;
        }
    };
    let pgid = child.id() as i32;
    let cancel_after_spawn = {
        let mut requests = active.lock().unwrap();
        if let Some(request) = requests.get_mut(&id) {
            request.pgid = Some(pgid);
            request.cancelled.load(Ordering::Acquire)
        } else {
            false
        }
    };
    if cancel_after_spawn {
        cancel_group(&active, &id, pgid);
    }
    let stop_out = child.stdout.take();
    let stop_err = child.stderr.take();
    let finished = Arc::new(AtomicBool::new(false));
    let out_finished = Arc::clone(&finished);
    let err_finished = Arc::clone(&finished);
    let out_reader = thread::spawn(move || stop_out.map(|pipe| read_bounded(pipe, cap, out_finished)).unwrap_or_default());
    let err_reader = thread::spawn(move || stop_err.map(|pipe| read_bounded(pipe, cap, err_finished)).unwrap_or_default());
    let started = Instant::now();
    let status = loop {
        let result = {
            let mut requests = active.lock().unwrap();
            let result = child.try_wait();
            if matches!(result, Ok(Some(_))) {
                if let Some(request) = requests.get_mut(&id) {
                    request.pgid = None;
                }
            }
            result
        };
        match result {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if timeout_secs > 0 && started.elapsed() >= Duration::from_secs(timeout_secs) {
                    unsafe { kill(-pgid, SIGTERM) };
                    thread::sleep(Duration::from_millis(100));
                    unsafe { kill(-pgid, SIGKILL) };
                    if let Some(request) = active.lock().unwrap().get_mut(&id) {
                        request.pgid = None;
                    }
                    break child.wait().unwrap_or_else(|_| std::process::ExitStatus::default());
                }
                thread::sleep(Duration::from_millis(10));
            }
            Err(_) => break child.wait().unwrap_or_else(|_| std::process::ExitStatus::default()),
        }
    };
    finished.store(true, Ordering::Release);
    let (stdout, stdout_cut) = out_reader.join().unwrap_or_default();
    let (stderr, stderr_cut) = err_reader.join().unwrap_or_default();
    write_line(
        &out,
        &format!(
            "RES|{id}|{}|{}|{}|{}|{}",
            exit_code(status),
            b64_encode(&stdout),
            b64_encode(&stderr),
            if stdout_cut { 1 } else { 0 },
            if stderr_cut { 1 } else { 0 }
        ),
    );
}

fn main() {
    let out: Out = Arc::new(Mutex::new(()));
    let fs_lock: Arc<Mutex<()>> = Arc::new(Mutex::new(()));
    let active: Active = Arc::new(Mutex::new(HashMap::new()));
    let envs: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
    // The host binds the running process to the binary it copied: the digest
    // is the sha256 of this executable, read through `/proc/self/exe`.
    let hello_digest = fs::read("/proc/self/exe").map(|bytes| sha256::sha256_hex(&bytes)).unwrap_or_default();
    write_line(&out, &format!("HELLO|wsl-agent|5|{}|{}", hello_digest, std::process::id()));
    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    while let Some(Ok(line)) = lines.next() {
        let fields: Vec<&str> = line.split('|').collect();
        match fields.get(0).copied().unwrap_or("") {
            "PING" => write_line(&out, "PONG"),
            "SHUTDOWN" => break,
            "KILL" => {
                if let Some(id) = fields.get(1) {
                    let pgid = active.lock().unwrap().get(*id).and_then(|request| {
                        request.cancelled.store(true, Ordering::Release);
                        request.pgid
                    });
                    if let Some(pgid) = pgid {
                        cancel_group(&active, id, pgid);
                    }
                }
            }
            "SETENV" => {
                if let (Some(key), Some(value)) = (fields.get(1), fields.get(2)) {
                    envs.lock().unwrap().insert((*key).to_string(), String::from_utf8_lossy(&b64_decode(value)).into_owned());
                }
            }
            "EXEC" => {
                let id = fields.get(1).copied().unwrap_or("").to_string();
                let cwd = fields.get(2).map(|v| String::from_utf8_lossy(&b64_decode(v)).into_owned()).unwrap_or_default();
                let timeout_secs = fields.get(3).and_then(|v| v.parse().ok()).unwrap_or(0);
                let nargs: usize = fields.get(4).and_then(|v| v.parse().ok()).unwrap_or(0);
                let cap: usize = fields.get(5).and_then(|v| v.parse().ok()).unwrap_or(0);
                let mut argv = Vec::with_capacity(nargs);
                for _ in 0..nargs {
                    match lines.next() {
                        Some(Ok(arg)) => argv.push(String::from_utf8_lossy(&b64_decode(&arg)).into_owned()),
                        _ => break,
                    }
                }
                let envs = Arc::clone(&envs);
                let active = Arc::clone(&active);
                let out = Arc::clone(&out);
                let cancelled = Arc::new(AtomicBool::new(false));
                active.lock().unwrap().insert(id.clone(), ActiveRequest { cancelled: Arc::clone(&cancelled), pgid: None });
                thread::spawn(move || handle_exec(id, cwd, argv, timeout_secs, cap, envs, active, cancelled, out));
            }
            "FS" => {
                let id = fields.get(1).copied().unwrap_or("").to_string();
                let op = fields.get(2).copied().unwrap_or("").to_string();
                let nargs: usize = fields.get(4).and_then(|v| v.parse().ok()).unwrap_or(0);
                let mut args = Vec::with_capacity(nargs);
                for _ in 0..nargs {
                    match lines.next() {
                        Some(Ok(arg)) => args.push(b64_decode(&arg)),
                        _ => break,
                    }
                }
                let out = Arc::clone(&out);
                let fs_lock = Arc::clone(&fs_lock);
                let active = Arc::clone(&active);
                let cancelled = Arc::new(AtomicBool::new(false));
                active.lock().unwrap().insert(id.clone(), ActiveRequest { cancelled: Arc::clone(&cancelled), pgid: None });
                thread::spawn(move || handle_fs(id, op, args, out, fs_lock, active, cancelled));
            }
            _ => write_line(&out, &format!("ERR||protocol|{}", b64_encode(b"unknown frame"))),
        }
    }
    for request in active.lock().unwrap().values() {
        if let Some(pgid) = request.pgid {
            unsafe { kill(-pgid, SIGTERM) };
        }
    }
}
