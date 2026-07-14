use std::path::PathBuf;

/// Резолвить git-корінь репозиторію з довільного tasks_dir усередині нього
/// (`git -C <tasks_dir> rev-parse --show-toplevel`) — спільний хелпер для
/// команд, яким потрібен саме корінь репо (remote claims, pipeline status).
pub fn repo_root(tasks_dir: &str) -> Result<PathBuf, String> {
    let out = std::process::Command::new("git")
        .args(["-C", tasks_dir, "rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("tasks dir is not inside a git repository".to_string());
    }
    Ok(PathBuf::from(String::from_utf8_lossy(&out.stdout).trim()))
}
