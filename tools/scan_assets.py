#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""扫描 Material 素材目录，生成 renderer/assets-manifest.js

用法: python3 tools/scan_assets.py
"""
import os, sys, struct, json

HERE = os.path.dirname(os.path.abspath(__file__))
MATERIAL = os.path.normpath(os.path.join(HERE, '..', '..', 'Material'))
OUT = os.path.join(HERE, '..', 'renderer', 'assets-manifest.js')

# 每个动画的默认循环/帧率（键名为 frames_transparent 下的子目录名）
ANIM_META = {
    'standing_wiggle': {'loop': True,  'fps': 24, 'kind': 'idle'},
    'sleep':           {'loop': True,  'fps': 12, 'kind': 'sleep'},
    'covering_face':   {'loop': False, 'fps': 24, 'kind': 'react'},
    'heart':           {'loop': False, 'fps': 24, 'kind': 'react'},
    'lying_read':      {'loop': True,  'fps': 18, 'kind': 'idle'},
    'pout_angry':      {'loop': False, 'fps': 24, 'kind': 'react'},
    'running_happy':   {'loop': False, 'fps': 30, 'kind': 'react'},
    'sitting_broom':   {'loop': False, 'fps': 24, 'kind': 'react'},
    'sitting_read':    {'loop': True,  'fps': 18, 'kind': 'idle'},
    'spinning':        {'loop': False, 'fps': 30, 'kind': 'react'},
    'typing_left':     {'loop': True,  'fps': 24, 'kind': 'idle'},
    'walk_left_right': {'loop': True,  'fps': 24, 'kind': 'walk'},
    'walk_slow_left':  {'loop': True,  'fps': 16, 'kind': 'walk'},
    '向左走':           {'loop': True,  'fps': 20, 'kind': 'walk'},
    '起床':             {'loop': False, 'fps': 24, 'kind': 'wakeup'},
}

EYE_FILES = {
    'front':   '看向前面.png',
    'left':    '看向左边.png',
    'right':   '看向右边.png',
    'up':      '看向上面.png',
    'upRight': '看向右上方.png',
}


def png_size(path):
    try:
        with open(path, 'rb') as f:
            head = f.read(33)
        if len(head) < 24:
            return None
        w, h = struct.unpack('>II', head[16:24])
        return [w, h]
    except Exception:
        return None


def scan_animations():
    root = os.path.join(MATERIAL, 'frames_transparent')
    out = {}
    if not os.path.isdir(root):
        print('[warn] frames_transparent 不存在:', root)
        return out
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if not os.path.isdir(d):
            continue
        pngs = [f for f in os.listdir(d) if f.lower().endswith('.png')]
        if not pngs:
            continue
        pngs.sort()
        size = png_size(os.path.join(d, pngs[0])) or [720, 720]
        meta = ANIM_META.get(name, {'loop': True, 'fps': 24, 'kind': 'idle'})
        out[name] = {
            'dir': 'frames_transparent/' + name,
            'count': len(pngs),
            'size': size,
            'loop': meta['loop'],
            'fps': meta['fps'],
            'kind': meta['kind'],
            'pattern': 'frame_{i:04d}.png',
            'first': pngs[0],
        }
    return out


def scan_eyes():
    root = os.path.join(MATERIAL, '静态动作', '跟随鼠标')
    out = {'dir': '静态动作/跟随鼠标', 'frames': {}}
    if not os.path.isdir(root):
        return out
    for key, fn in EYE_FILES.items():
        if os.path.exists(os.path.join(root, fn)):
            out['frames'][key] = fn
    return out


def scan_poses():
    root = os.path.join(MATERIAL, '静态动作')
    out = {}
    for key, sub in (('sleep', '睡着了'), ('picked', '被拎起来的样子')):
        d = os.path.join(root, sub)
        if os.path.isdir(d):
            pngs = [f for f in os.listdir(d) if f.lower().endswith('.png')]
            if pngs:
                pngs.sort()
                out[key] = {'dir': '静态动作/' + sub, 'file': pngs[0]}
    return out


def scan_smoke():
    """烟雾过渡特效放在 动态/烟雾，命名 1.png..N.png（无补零）。
    它不属于 frames_transparent，必须单独扫描，否则重跑扫描会丢失该条目。"""
    root = os.path.join(MATERIAL, '动态', '烟雾')
    if not os.path.isdir(root):
        return None
    pngs = [f for f in os.listdir(root) if f.lower().endswith('.png')]
    if not pngs:
        return None
    pngs.sort()
    size = png_size(os.path.join(root, pngs[0])) or [2048, 2048]
    return {
        'dir': '动态/烟雾',
        'count': len(pngs),
        'size': size,
        'loop': True,
        'fps': 16,
        'kind': 'transition',
        'pattern': '{i}.png',
        'first': pngs[0],
        'key': True,
        'keyTol': 40,
    }


def main():
    animations = scan_animations()
    smoke = scan_smoke()
    if smoke:
        animations['smoke'] = smoke
    eyes = scan_eyes()
    poses = scan_poses()
    manifest = {
        'base': MATERIAL.replace('\\', '/'),
        'animations': animations,
        'eyes': eyes,
        'poses': poses,
    }
    js = '// 本文件由 tools/scan_assets.py 自动生成，勿手动修改\n'
    js += 'window.ASSET_BASE = window.ASSET_BASE || ' + json.dumps(manifest['base'], ensure_ascii=False) + ';\n'
    manifest_json = json.dumps(manifest, ensure_ascii=False, indent=2)
    # 让素材根目录跟随运行时注入的 window.ASSET_BASE（打包后指向 resources/Material），
    # 不再写死开发机绝对路径，避免装到别的机器白屏。
    manifest_json = manifest_json.replace('"base": ' + json.dumps(manifest['base'], ensure_ascii=False), '"base": window.ASSET_BASE')
    js += 'window.ASSET_MANIFEST = ' + manifest_json + ';\n'
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(js)
    print('已生成:', OUT)
    print('  动画数:', len(animations))
    for k, v in animations.items():
        print('   - %s : %d帧 %s loop=%s fps=%d' % (k, v['count'], v['size'], v['loop'], v['fps']))
    print('  眼睛帧:', list(eyes['frames'].keys()))
    print('  姿势帧:', list(poses.keys()))


if __name__ == '__main__':
    main()
