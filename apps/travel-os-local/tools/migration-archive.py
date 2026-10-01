"""ZIP transport for the local business snapshot. No browser data or network access."""
import json
import sys
import zipfile
from pathlib import Path

mode, archive, folder = sys.argv[1:]
base = Path(folder).resolve()
if mode == 'pack':
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_STORED, allowZip64=True) as z:
        for f in sorted(base.rglob('*')):
            if f.is_file() and not f.is_symlink():
                z.write(f, f.relative_to(base).as_posix())
elif mode == 'unpack':
    with zipfile.ZipFile(archive) as z:
        manifest = json.loads(z.read('MIGRATION_MANIFEST.json'))
        allowed = {f['path'] for f in manifest['files']} | {'MIGRATION_MANIFEST.json'}
        names = z.namelist()
        if len(names) != len(set(names)) or set(names) != allowed:
            raise ValueError('ZIP contains missing, repeated, or unexpected entries')
        for name in names:
            parts = name.split('/')
            if any(p in ('', '.', '..') or ':' in p or '\\' in p for p in parts):
                raise ValueError('Unsafe archive path')
            target = (base / name).resolve()
            if not target.is_relative_to(base):
                raise ValueError('Archive path escapes target')
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as out, z.open(name) as src:
                while block := src.read(1024 * 1024):
                    out.write(block)
else:
    raise ValueError('Unknown operation')
