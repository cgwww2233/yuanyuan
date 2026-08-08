// afterPack hook: stamp the app exe icon using our own Win32 UpdateResource script.
// We do NOT use app-builder rcedit because it pulls winCodeSign, whose extraction
// fails on this machine due to missing symlink-creation privilege. stamp_icon.py
// is self-contained and needs no downloads / no admin / no code signing.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  try {
    const projectRoot = path.resolve(__dirname, '..');
    const productFilename =
      (context.packager && context.packager.appInfo && context.packager.appInfo.productFilename) || '园园';
    const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
    if (!fs.existsSync(exePath)) {
      console.log('[afterPack] app exe not found, skip icon stamp:', exePath);
      return;
    }
    const iconPath = path.resolve(projectRoot, 'build/icon.ico');
    if (!fs.existsSync(iconPath)) {
      console.warn('[afterPack] icon not found, skip:', iconPath);
      return;
    }
    const scriptPath = path.resolve(projectRoot, 'tools/stamp_icon.py');

    // Prefer the managed Python 3.13; fall back to PATH python/python3.
    const candidates = [
      process.env.PYTHON,
      'C:/Users/CGW/.workbuddy/binaries/python/versions/3.13.12/python.exe',
      'python3',
      'python',
    ];
    let python = null;
    for (const c of candidates) {
      if (!c) continue;
      if (fs.existsSync(c)) {
        python = c;
        break;
      }
      try {
        execFileSync(c, ['--version'], { stdio: 'ignore' });
        python = c;
        break;
      } catch (_) {}
    }
    if (!python) {
      console.warn('[afterPack] Python not found, skip icon stamp');
      return;
    }

    console.log('[afterPack] stamping icon via stamp_icon.py...');
    execFileSync(python, [scriptPath, exePath, iconPath], { stdio: 'inherit', cwd: projectRoot });
    console.log('[afterPack] ✅ icon stamp completed');
  } catch (e) {
    console.warn('[afterPack] icon stamp failed:', e && e.message ? e.message : e);
  }
};
