"""Generate original CC0 demo cues and explicitly illustrated family placeholders."""
import math
import struct
import wave
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'assets'
sequences = {
    'idle': [(440, .16)], 'listening': [(523, .12), (659, .16)],
    'thinking': [(392, .12), (440, .12), (392, .12)], 'speaking': [(587, .10)],
    'happy': [(523, .13), (659, .13), (784, .20)],
    'worried': [(440, .17), (349, .24)], 'alert': [(659, .14), (523, .14), (659, .20)]}
rate = 22050
for name, notes in sequences.items():
    samples = []
    for hz, duration in notes:
        count = int(rate * duration)
        for i in range(count):
            t = i / rate
            envelope = math.sin(math.pi * i / count) ** 2
            # Pure quiet tone with a soft attack/release; no sampled third-party material.
            samples.append(int(32767 * .19 * envelope * math.sin(2 * math.pi * hz * t)))
        samples.extend([0] * int(rate * .025))
    with wave.open(str(root / 'sounds' / f'{name}.wav'), 'wb') as output:
        output.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        output.writeframes(struct.pack('<' + 'h' * len(samples), *samples))

scenes = [('A day together','#dceaf2','#638ca7'),('Family picnic','#e9eddb','#789460'),('By the lake','#e1e6f4','#8594bd'),('Celebrating together','#f3e1d9','#c18b76'),('A walk in the park','#e4eadd','#879e71')]
for n,(title,bg,accent) in enumerate(scenes,1):
    people = ''
    for x,y,size,color in [(240,245,1.1,'#536d88'),(380,235,1.15,accent),(510,300,.8,'#bd9277'),(640,280,.9,'#899c90')]:
        people += f'<g transform="translate({x} {y}) scale({size})"><circle r="40" fill="#dfbda7"/><path d="M-60 135V82a60 60 0 0 1 120 0v53" fill="{color}"/></g>'
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="900" height="675" viewBox="0 0 900 675" role="img" aria-label="Illustrated family placeholder {n}"><rect width="900" height="675" fill="{bg}"/><circle cx="735" cy="115" r="48" fill="#fff8df"/><path d="M0 440Q230 330 450 455T900 420V675H0" fill="{accent}" opacity=".22"/>{people}<text x="450" y="550" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#344657">{title}</text><text x="450" y="594" text-anchor="middle" font-family="sans-serif" font-size="17" fill="#53636d">FAMILY PHOTO PLACEHOLDER {n} · Replace with your own photo</text></svg>'''
    (root / 'photos' / f'family-{n}.svg').write_text(svg)
print('Generated 7 original WAV cues and 5 SVG family placeholders.')
