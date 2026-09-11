"""Where a project file may live.

A `.xknx` project is a live SQLite database: it needs POSIX file locking and journal sidecars.
Network filesystems do not provide those reliably. Upstream's write probe
(:func:`xknxeditor.proj.ensure_sqlite_writable`) catches the locations that refuse a write, but some
SMB mounts accept the probe and then **hang** on the first real lock. The editor runs every project
operation on one worker thread, so a hang there freezes the whole add-on — worth refusing up front.

Home Assistant mounts network storage under /share and /media, so this is reachable in normal use:
the user adds a NAS share in Settings -> System -> Storage and keeps a project on it.

Upstream (v0.1.2) answers this by mirroring the project to a local working copy and writing it back
on close. The add-on does not: projects live in /config/projects by default, and a write-back on
close would risk losing edits whenever the container stops uncleanly. We refuse and explain instead.
"""

from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger(__name__)

MOUNTINFO = Path("/proc/self/mountinfo")

# Filesystems that cannot host a live SQLite database. Taken from upstream's list (v0.1.2), minus
# the macOS-only entries, plus the ones Home Assistant itself mounts network storage with.
NETWORK_FILESYSTEMS = frozenset(
    {
        "afpfs",
        "cifs",
        "ftp",
        "fuse.sshfs",
        "fusefs.sshfs",
        "nfs",
        "nfs4",
        "smb3",
        "smbfs",
        "webdav",
    }
)


def filesystem_at(location: str, mountinfo: Path = MOUNTINFO) -> str | None:
    """The filesystem type mounted at ``location`` (an absolute POSIX path), or ``None``.

    Picks the longest matching mount point in ``/proc/self/mountinfo``, so a share mounted deep
    inside /share wins over the root mount. Pure string matching, so it is testable off-Linux.
    """
    best_point = ""
    best_type: str | None = None
    try:
        with mountinfo.open(encoding="utf-8") as handle:
            for line in handle:
                left, sep, right = line.partition(" - ")
                fields = left.split()
                if not sep or len(fields) < 5 or not right:
                    continue
                point = fields[4]
                if location != point and not location.startswith(point.rstrip("/") + "/"):
                    continue
                if len(point) >= len(best_point):
                    best_point, best_type = point, right.split(maxsplit=1)[0]
    except OSError:
        return None
    return best_type


def filesystem_of(path: Path, mountinfo: Path = MOUNTINFO) -> str | None:
    """The filesystem type ``path`` sits on, or ``None`` when it cannot be determined.

    Best-effort: any error means "unknown", and the caller falls back to the write probe.
    """
    try:
        target = path if path.exists() else path.parent
        resolved = target.resolve().as_posix()
    except OSError:
        return None
    return filesystem_at(resolved, mountinfo)


def network_filesystem(path: Path, mountinfo: Path = MOUNTINFO) -> str | None:
    """The network filesystem type ``path`` sits on, or ``None`` if it is local (or unknown)."""
    fstype = filesystem_of(path, mountinfo)
    if fstype is None:
        return None
    return fstype if fstype in NETWORK_FILESYSTEMS else None


def refuse_network_location(path: Path, action: str) -> str | None:
    """A message explaining why ``path`` cannot host a live project, or ``None`` if it can."""
    fstype = network_filesystem(path)
    if fstype is None:
        return None
    log.info("refusing to %s %s: %s is a network filesystem", action, path, fstype)
    return (
        f"{path.parent} is a network share ({fstype}). KNX project files are SQLite databases and "
        "need file locking that network shares do not provide reliably, so working on one can hang "
        "or corrupt the project. Import the project instead, or copy the file into /config, and use "
        "Save a copy to put a backup back on the share."
    )
