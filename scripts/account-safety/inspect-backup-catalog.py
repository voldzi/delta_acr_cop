#!/usr/bin/env python3
"""Read-only inventory on an existing Proxmox node; no credentials or content.

This is an operator inventory source, not a runtime backup/restore authority.
Its JSON alone must never make a COP erasure owner complete or ready.
"""
import datetime
import json
import os
import subprocess
import time

TARGETS = frozenset({101, 104, 108, 111, 112})
STORAGE = "pbs-backup"


def api(path, *arguments):
    result = subprocess.run(["/usr/bin/pvesh", "get", path, "--output-format", "json", *arguments],
                            capture_output=True, text=True, timeout=30, check=False)
    if result.returncode:
        raise RuntimeError("BACKUP_CATALOG_UNAVAILABLE")
    value = json.loads(result.stdout)
    if not isinstance(value, list):
        raise RuntimeError("BACKUP_CATALOG_UNPROVEN")
    return value


def timestamp(value):
    if type(value) not in (int, float) or value <= 0 or int(value) != value:
        raise RuntimeError("BACKUP_TIME_UNPROVEN")
    return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def inspect():
    if os.geteuid() != 0:
        raise RuntimeError("PROXMOX_READ_AUTHORITY_REQUIRED")
    resources = api("/cluster/resources", "--type", "vm")
    selected = [r for r in resources if r.get("vmid") in TARGETS]
    if len(selected) != len(TARGETS) or {r["vmid"] for r in selected} != TARGETS:
        raise RuntimeError("TARGET_INVENTORY_UNPROVEN")
    rows = []
    for resource in sorted(selected, key=lambda r: r["vmid"]):
        vmid, node, kind = resource["vmid"], resource.get("node"), resource.get("type")
        if kind != "qemu" or node not in {"proxmox", "proxmox0", "proxmox2", "proxmox3"}:
            raise RuntimeError("TARGET_TOPOLOGY_UNPROVEN")
        snapshots = api(f"/nodes/{node}/qemu/{vmid}/snapshot")
        backups = api(f"/nodes/{node}/storage/{STORAGE}/content", "--content", "backup", "--vmid", str(vmid))
        if any(row.get("content") != "backup" or row.get("vmid") != vmid for row in backups):
            raise RuntimeError("BACKUP_TARGET_UNPROVEN")
        times = sorted(timestamp(row.get("ctime")) for row in backups)
        rows.append({"vmId": vmid, "node": node, "storage": STORAGE, "listedBackupCount": len(backups),
                     "oldestCreatedAt": times[0] if times else None, "newestCreatedAt": times[-1] if times else None,
                     "nonCurrentSnapshotCount": sum(row.get("name") != "current" for row in snapshots)})
    return {"contractVersion": "cop-proxmox-backup-inventory-v1", "observedAt": timestamp(int(time.time())),
            "scope": "configured_pbs_backup_and_vm_snapshot_catalog_for_five_COP_dependencies", "rows": rows,
            "readOnly": True, "contentsRead": False, "retentionChanged": False,
            "restorationTested": False, "runtimeAuthority": False, "wholeAccountReady": False}


if __name__ == "__main__":
    try:
        print(json.dumps(inspect(), separators=(",", ":")))
    except Exception:
        print(json.dumps({"contractVersion": "cop-proxmox-backup-inventory-v1", "code": "BACKUP_INVENTORY_UNPROVEN",
                          "readOnly": True, "wholeAccountReady": False}))
        raise SystemExit(1)
