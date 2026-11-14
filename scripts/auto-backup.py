#!/usr/bin/env python3
"""Maintain one rolling date-named ZIP backup of a project."""
from __future__ import annotations

import argparse
import hashlib
import os
from datetime import datetime
from pathlib import Path, PurePosixPath
import stat
import tempfile
import time
from zoneinfo import ZoneInfo
import zipfile

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKUP_DIR = PROJECT_ROOT.parent / "ReadSW-Console-backups"
EXCLUDED_DIRS = {"node_modules"}
EXCLUDED_FILES = {"package-lock.json"}
WEEKDAYS_ID = ("Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu")
MONTHS_ID = (
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
)


def dated_output(root: Path) -> Path:
    now = datetime.now(ZoneInfo("Asia/Jakarta"))
    filename = f"{WEEKDAYS_ID[now.weekday()]}{now.day}-{MONTHS_ID[now.month - 1]}{now.year}.zip"
    return root.resolve().parent / "ReadSW-Console-backups" / filename


def prune_daily_archives(output: Path) -> None:
    """The dedicated backup directory retains only today's ZIP."""
    output.parent.mkdir(parents=True, exist_ok=True)
    for old in output.parent.glob("*.zip"):
        if old != output:
            old.unlink()


def iter_project_paths(root: Path):
    for base, dirnames, filenames in os.walk(root, followlinks=False):
        base_path = Path(base)
        dirnames[:] = sorted(
            name for name in dirnames
            if name.lower() not in EXCLUDED_DIRS
            and not (base_path / name).is_symlink()
        )
        relative_dir = base_path.relative_to(root)
        if relative_dir.parts:
            yield base_path, True
        for name in sorted(filenames):
            if name.lower() in EXCLUDED_FILES:
                continue
            path = base_path / name
            if path.is_symlink():
                raise RuntimeError(f"Refusing to back up symlink: {path}")
            if path.is_file():
                yield path, False


def inventory(root: Path):
    """Hash included files so content edits are detected even if mtime is preserved."""
    result = []
    for path, is_dir in iter_project_paths(root):
        relative = path.relative_to(root).as_posix()
        if is_dir:
            result.append(("D", relative))
            continue
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        result.append(("F", relative, path.stat().st_size, digest.hexdigest()))
    return tuple(result)


def create_backup(root: Path, output: Path, attempts: int = 5):
    root = root.resolve()
    output = output.resolve()
    if output == root or root in output.parents:
        raise ValueError("Backup ZIP must be outside the watched project directory.")
    output.parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(1, attempts + 1):
        before = inventory(root)
        fd, temp_name = tempfile.mkstemp(
            prefix=output.name + ".", suffix=".tmp", dir=output.parent
        )
        os.close(fd)
        temp_path = Path(temp_name)
        try:
            with zipfile.ZipFile(
                temp_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6
            ) as archive:
                for path, is_dir in iter_project_paths(root):
                    relative = path.relative_to(root).as_posix()
                    if is_dir:
                        info = zipfile.ZipInfo(relative.rstrip("/") + "/")
                        info.external_attr = (stat.S_IFDIR | 0o700) << 16
                        archive.writestr(info, b"")
                    else:
                        info = zipfile.ZipInfo(relative)
                        source_mode = path.stat().st_mode
                        permissions = 0o700 if source_mode & 0o111 else 0o600
                        info.external_attr = (stat.S_IFREG | permissions) << 16
                        archive.writestr(info, path.read_bytes())
            os.chmod(temp_path, 0o600)
            after = inventory(root)
            if before != after:
                if attempt == attempts:
                    raise RuntimeError("Project changed repeatedly while the ZIP was being built.")
                time.sleep(1)
                continue
            with zipfile.ZipFile(temp_path) as archive:
                bad_member = archive.testzip()
                if bad_member:
                    raise RuntimeError(f"ZIP integrity check failed at {bad_member}")
                names = [member.filename for member in archive.infolist()]
                if any(
                    any(part.lower() in EXCLUDED_DIRS for part in PurePosixPath(name).parts)
                    or PurePosixPath(name).name.lower() in EXCLUDED_FILES
                    for name in names
                ):
                    raise RuntimeError("Excluded dependency files found in the ZIP.")
            os.replace(temp_path, output)
            os.chmod(output, 0o600)
            return len([item for item in before if item[0] == "F"]), output.stat().st_size
        finally:
            try:
                temp_path.unlink()
            except FileNotFoundError:
                pass
    raise RuntimeError("Could not produce a stable backup.")


def main():
    parser = argparse.ArgumentParser(
        description="Create one rolling ZIP named for today's Indonesian date; refresh after file changes."
    )
    parser.add_argument("--source", type=Path, default=PROJECT_ROOT)
    parser.add_argument("--output", type=Path, help="optional fixed output path; default uses today's WIB date")
    parser.add_argument("--poll-seconds", type=float, default=3.0)
    parser.add_argument("--quiet-seconds", type=float, default=2.0)
    parser.add_argument("--once", action="store_true", help="create one backup and exit")
    args = parser.parse_args()
    root = args.source.resolve()
    fixed_output = args.output.resolve() if args.output else None
    output = fixed_output or dated_output(root)
    if not root.is_dir():
        parser.error(f"Source directory does not exist: {root}")
    if args.poll_seconds < 1 or args.quiet_seconds < 0:
        parser.error("poll interval must be >= 1 second; quiet period must be >= 0")

    count, size = create_backup(root, output)
    if fixed_output is None:
        prune_daily_archives(output)
    print(f"[backup] Updated {output} ({count} files, {size} bytes)", flush=True)
    if args.once:
        return

    previous = inventory(root)
    changed_at = None
    print(
        f"[watch] Monitoring {root}; polling every {args.poll_seconds:g}s. "
        "One WIB-date-named ZIP is retained; node_modules and package-lock.json are excluded.",
        flush=True,
    )
    while True:
        time.sleep(args.poll_seconds)
        current = inventory(root)
        desired_output = fixed_output or dated_output(root)
        if current != previous:
            previous = current
            changed_at = time.monotonic()
            print("[watch] Project change detected; waiting for writes to settle.", flush=True)
        if desired_output != output and changed_at is None:
            changed_at = time.monotonic()
            print("[watch] WIB date changed; preparing today's ZIP name.", flush=True)
        if changed_at is not None and time.monotonic() - changed_at >= args.quiet_seconds:
            try:
                count, size = create_backup(root, desired_output)
                if fixed_output is None:
                    prune_daily_archives(desired_output)
                output = desired_output
                previous = inventory(root)
                print(f"[backup] Updated {output} ({count} files, {size} bytes)", flush=True)
                changed_at = None
            except Exception as exc:
                print(f"[backup] ERROR: {type(exc).__name__}: {exc}", flush=True)
                changed_at = time.monotonic()


if __name__ == "__main__":
    main()
