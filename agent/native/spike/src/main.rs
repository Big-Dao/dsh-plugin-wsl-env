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
use std::io::{self, BufRead, Read, Write};
use std::os::unix::process::CommandExt;
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
                let id = fields.get(1).copied().unwrap_or("");
                let nargs: usize = fields.get(4).and_then(|v| v.parse().ok()).unwrap_or(0);
                for _ in 0..nargs {
                    let _ = lines.next();
                }
                write_line(&out, &format!("ERR|{id}|protocol|{}", b64_encode(b"FS is not in this spike")));
            }
            _ => write_line(&out, &format!("ERR||protocol|{}", b64_encode(b"unknown frame"))),
        }
    }
    for (_, pgid) in active.lock().unwrap().iter() {
        unsafe { kill(-*pgid, SIGTERM) };
    }
}
