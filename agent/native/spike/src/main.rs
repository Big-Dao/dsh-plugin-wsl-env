//! Spike for ADR 0002: an EXEC/KILL event loop with per-request process groups.
//!
//! Scope of this spike (deliberately small):
//!   HELLO, PING, SHUTDOWN, SETENV, EXEC, KILL.
//! FS frames are consumed and refused; the shell's FS record/staging formats
//! are the next stage.
//!
//! It exists to answer two questions with real code: can a native loop keep
//! one command running while another finishes (the shell's serial stall), and
//! can a KILL/timeout take the request's whole process group without a second
//! wsl.exe or USR1?
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, Read, Seek, SeekFrom, Write};
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const SIGTERM: i32 = 15;
const SIGKILL: i32 = 9;

extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
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

fn write_line(out: &Out, line: &str) {
    let _guard = out.lock().unwrap();
    let mut stdout = io::stdout().lock();
    let _ = stdout.write_all(line.as_bytes());
    let _ = stdout.write_all(b"\n");
    let _ = stdout.flush();
}

fn read_bounded<R: Read>(mut reader: R, cap: usize) -> (Vec<u8>, bool) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut cut = false;
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
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
            Err(_) => break,
        }
    }
    (buffer, cut)
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
        "{}:{}:{}:{}.{:09}:{}.{:09}",
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

fn handle_fs(
    id: String,
    op: String,
    args: Vec<Vec<u8>>,
    out: Out,
    fs_lock: Arc<Mutex<()>>,
) {
    let _serial = fs_lock.lock().unwrap();
    write_line(&out, &format!("ACK|{id}"));
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
            let staging = directory.join(format!(".{base}.{}.tmpdir", std::process::id()));
            let _ = fs::remove_dir_all(&staging);
            let temp = match fs::create_dir(&staging).and_then(|_| {
                let _ = fs::set_permissions(&staging, fs::Permissions::from_mode(0o700));
                let temp = staging.join(format!("{base}.tmp"));
                let mut file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(&temp)?;
                file.write_all(&content)?;
                file.sync_all()?;
                Ok(temp)
            }) {
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
    timeout_ms: u64,
    cap: usize,
    envs: Arc<Mutex<HashMap<String, String>>>,
    active: Arc<Mutex<HashMap<String, i32>>>,
    out: Out,
) {
    write_line(&out, &format!("ACK|{id}"));
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
    active.lock().unwrap().insert(id.clone(), pgid);
    let stop_out = child.stdout.take();
    let stop_err = child.stderr.take();
    let out_reader = thread::spawn(move || stop_out.map(|pipe| read_bounded(pipe, cap)).unwrap_or_default());
    let err_reader = thread::spawn(move || stop_err.map(|pipe| read_bounded(pipe, cap)).unwrap_or_default());
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if timeout_ms > 0 && started.elapsed() >= Duration::from_millis(timeout_ms) {
                    unsafe { kill(-pgid, SIGTERM) };
                    thread::sleep(Duration::from_millis(100));
                    unsafe { kill(-pgid, SIGKILL) };
                    break child.wait().unwrap_or_else(|_| std::process::ExitStatus::default());
                }
                thread::sleep(Duration::from_millis(10));
            }
            Err(_) => break child.wait().unwrap_or_else(|_| std::process::ExitStatus::default()),
        }
    };
    active.lock().unwrap().remove(&id);
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
    let active: Arc<Mutex<HashMap<String, i32>>> = Arc::new(Mutex::new(HashMap::new()));
    let envs: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
    write_line(&out, &format!("HELLO|wsl-agent|5||{}", std::process::id()));
    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    while let Some(Ok(line)) = lines.next() {
        let fields: Vec<&str> = line.split('|').collect();
        match fields.get(0).copied().unwrap_or("") {
            "PING" => write_line(&out, "PONG"),
            "SHUTDOWN" => break,
            "KILL" => {
                if let Some(id) = fields.get(1) {
                    if let Some(pgid) = active.lock().unwrap().get(*id).copied() {
                        unsafe { kill(-pgid, SIGTERM) };
                        thread::spawn(move || {
                            thread::sleep(Duration::from_millis(3000));
                            unsafe { kill(-pgid, SIGKILL) };
                        });
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
                let timeout_ms = fields.get(3).and_then(|v| v.parse().ok()).unwrap_or(0);
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
                thread::spawn(move || handle_exec(id, cwd, argv, timeout_ms, cap, envs, active, out));
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
                thread::spawn(move || handle_fs(id, op, args, out, fs_lock));
            }
            _ => write_line(&out, &format!("ERR||protocol|{}", b64_encode(b"unknown frame"))),
        }
    }
    for (_, pgid) in active.lock().unwrap().iter() {
        unsafe { kill(-*pgid, SIGTERM) };
    }
}
