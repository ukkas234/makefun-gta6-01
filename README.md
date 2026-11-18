# Solmara — Open-World Crime Sandbox

An open-world crime sandbox in the spirit of GTA 6, built for the make.fun
"gta6-01" competition. Explore the coastal city of **Solmara** on foot and by
car as **Danny Reyes**: steal cars, outrun the police, fight, and work through
a five-mission story — or just cruise the neon streets at night.

Everything is original: city, characters, vehicles, story, art and sound.
No network requests — all art is canvas-generated and all sound is
synthesised with WebAudio. Runs offline in a desktop browser from static
files.

## How to run

```sh
node serve.ts
```

Then open http://localhost:8080

(No build step. Requires Node 22 for `serve.ts` / `main.ts`.)

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move (on foot) / drive (in car) |
| Mouse drag | Orbit camera |
| Shift | Run (on foot) / handbrake (in car) |
| Space | Jump (on foot) / handbrake (in car) |
| E | Enter / exit / steal car · hold 3 s to grab bank cash (mission 5) |
| F | Punch |
| Q | Draw / holster pistol |
| Left mouse | Shoot (armed) / punch (unarmed) |
| R | Flip / reset car |
| M | Mute |
| Esc / P | Pause |
| Missions | Start from the title screen or the pause menu |

## Missions

1. **First Wheels** — steal any car, drive it to the garage. $200
2. **Hot Deliveries** — deliver 3 packages within 150 s. $350
3. **Lose the Heat** — start at 2 stars and get back to 0. $400
4. **The Pickup** — grab the briefcase on foot, escape a 2-star chase to the safehouse. $500
5. **The Big One** — rob the bank, escape a 3-star chase to the safehouse. $1,500 + Story Complete

10 hidden packages are scattered around the city ($50 each). Getting busted
costs $100, getting wasted costs $50. Progress saves automatically to the
browser (`solmara-save-v1`).

## Layout

- `game/index.html` — page + HUD DOM
- `game/src/` — plain ES modules: `main.js` (boot/loop/screens), `config.js`,
  `random.js`, `textures.js`, `city.js`, `render.js`, `input.js`, `player.js`,
  `vehicles.js`, `traffic.js`, `police.js`, `missions.js`, `hud.js`,
  `audio.js`, `save.js`, `shots.js`
- `game/vendor/three.module.js` — vendored Three.js 0.187.0 (MIT)
- `screenshots/` — the 4 competition screenshots, staged via `shots.json`

## License

MIT — see `LICENSE`.
