# Aerodynamic stability and rotational damping analysis

Этот этап расширяет существующий Besiege blade solver численным анализом. Он не добавляет аэродинамических формул, inertia response, angular acceleration, control actuation, joint reconstruction, runtime exporter или UI.

## 1. Coordinate and sign conventions

Существующий solver уже использовал machine-local frame:

- forward = `+Z`;
- up = `+Y`;
- right = `+X = up × forward`;
- pitch moment = `Mx`, roll moment = `Mz`, yaw moment = `My`.

Эта convention сохранена. Для `AnalysisState`:

- `p` — roll rate вокруг `+Z`;
- `q` — pitch rate вокруг `+X`;
- `r` — yaw rate вокруг `+Y`;
- поэтому Unity/machine-local `omega = (q, r, p)`.

По правилу правой руки положительный `q` поворачивает `+Z` к `-Y`, то есть является nose-down в этой Y-up системе. Положительный `r` поворачивает `+Z` к `+X`. Это может отличаться от знаков в другой aerospace body-axis convention; CLI и JSON всегда записывают используемое отображение.

`alpha`/`beta` изменяют translational velocity в неподвижных machine axes. Геометрия и quaternion машины не поворачиваются.

Начав с `+Z`, velocity сначала поворачивается на alpha вокруг `+X`, затем на beta вокруг `+Y`:

```text
Vx = speed cos(alpha) sin(beta)
Vy = -speed sin(alpha)
Vz = speed cos(alpha) cos(beta)
```

Следовательно:

- positive alpha направляет velocity от `+Z` к `-Y`;
- positive beta направляет velocity от `+Z` к `+X`;
- magnitude остаётся равной `speed`.

Synthetic tests отдельно проверяют `±alpha`, `±beta`, отображение `omega=(q,r,p)`, restoring signs и зеркальную геометрию.

## 2. Operating point

`AnalysisState` содержит:

- `speed`;
- `alpha`, `beta` в radians внутри core;
- `p`, `q`, `r` в rad/s;
- выбранный CG;
- полный `AnalysisGroup`.

CLI принимает alpha/beta и их steps в degrees. В JSON сохраняются radians, degrees, linear velocity, angular velocity, CG и summary выбранной AnalysisGroup.

## 3. Derivatives and units

Все derivatives вычисляются без fit/smoothing центральной разностью:

```text
dY/dx = (Y(x+h) - Y(x-h)) / (2h)
```

Static derivatives:

- `dM_pitch/dAlpha`;
- `dM_yaw/dBeta`;
- `dM_roll/dBeta`;
- `d(Fx,Fy,Fz)/dAlpha`;
- `d(Fx,Fy,Fz)/dBeta`.

Rotational damping derivatives:

- `dM_roll/dp`;
- `dM_pitch/dq`;
- `dM_yaw/dr`.

Cross-rate derivatives:

- `dM_pitch/dr`, `dM_pitch/dp`;
- `dM_yaw/dq`, `dM_yaw/dp`;
- `dM_roll/dq`, `dM_roll/dr`.

Raw units:

- angle derivatives: force/radian или moment/radian;
- rate derivatives: moment/(rad/s).

Безразмерные coefficients не вычисляются.

Default steps:

- alpha: `1°`;
- beta: `1°`;
- rate: `0.01 rad/s`.

## 4. Sweeps and blade contributions

Alpha/beta sweep использует абсолютные точки `-15, -10, -5, 0, +5, +10, +15°`. Rate sweeps отдельно задают `p`, `q` или `r` как `-0.50, -0.25, -0.10, 0, +0.10, +0.25, +0.50 rad/s`. Остальные state variables остаются на operating point. В каждой точке сохраняются total force, все три moments и blade power; данные не сглаживаются.

Per-blade central differences поддержаны для:

- `pitch-damping` = `dM_pitch/dq`;
- `yaw-damping` = `dM_yaw/dr`;
- `roll-damping` = `dM_roll/dp`;
- `pitch-alpha` = `dM_pitch/dAlpha`;
- `yaw-beta` = `dM_yaw/dBeta`.

Вывод содержит GUID, ID/type, position, flipped, baseline moment vector, baseline projected moment, signed derivative, absolute derivative и signed percentage of total. Строки сортируются по absolute contribution. При cancellation процент может быть отрицательным или больше 100%; это не нормализуется. Test проверяет `sum(per-blade derivative) == total derivative`.

## 5. CLI

Пример одиночного анализа:

```powershell
.\run.ps1 --bsg "C:\path\machine.bsg" --analyze-stability --mass-group aircraft-heuristic --speed 100 --alpha 0 --beta 0 --p 0 --q 0 --r 0 --sweep-alpha --sweep-pitch-rate --blade-contributions "pitch-damping,pitch-alpha" --contribution-limit 10
```

Сравнение:

```powershell
.\run.ps1 --compare "C:\path\Проект Ескапе.bsg" "C:\path\Saab JAS 39 Gripen2.bsg" --mass-group aircraft-heuristic --speed 100 --alpha 0 --beta 0 --p 0 --q 0 --r 0 --sweep-pitch-rate --sweep-yaw-rate --blade-contributions "pitch-damping,yaw-damping" --contribution-limit 10
```

Добавление `--json` выдаёт operating point, steps, derivative values, units/convention, component diagnostics, sweeps и contribution rows как JSON.

## 6. Real comparison setup

Fixtures:

- `Проект Ескапе.bsg`;
- `Saab JAS 39 Gripen2.bsg`.

Одинаковый operating point:

```text
speed=100
alpha=0, beta=0
p=0, q=0, r=0
alphaStep=1°, betaStep=1°, rateStep=0.01 rad/s
```

Для обеих машин явно выбрана `--mass-group aircraft-heuristic`. Это **HEURISTIC**, не verified physical component membership.

- Eskapie suggestion: 201 из 230 blocks, 37 blades; вне группы кластеры 28 и 1 block.
- Gripen suggestion: 279 из 318 blocks, 43 blades; вне группы пять кластеров по 15, 13, 4, 4 и 3 blocks.

## 7. Baseline comparison

| Raw quantity | Проект Ескапе | Saab JAS 39 Gripen2 |
|---|---:|---:|
| Machine blocks | 230 | 318 |
| Selected blocks (HEURISTIC) | 201 | 279 |
| Approximate mass | 77.800001 | 82.400000 |
| Approximate CG | (0.000964, -2.466808, -0.177009) | (6.281471, 1.090539, 0.771926) |
| Blades | 37 | 43 |
| Propeller / SmallPropeller | 14 / 23 | 0 / 43 |
| Total force | (2.803082, 76.572072, 125.984096) | (40.389212, -569.651582, -210.510391) |
| Pitch / roll / yaw moment | -168.533191 / -3.844550 / 5.313004 | -76.687551 / -51.626666 / -184.238802 |
| Total blade power | 12598.409641 | -21051.039058 |

## 8. Static and damping derivatives

| Derivative | Units | Проект Ескапе | Saab JAS 39 Gripen2 |
|---|---|---:|---:|
| dM_pitch/dAlpha | moment/radian | -1913.914057 | 30575.976477 |
| dM_yaw/dBeta | moment/radian | 523.962245 | 22663.306581 |
| dM_roll/dBeta | moment/radian | -3348.323639 | 13116.759354 |
| dM_roll/dp | moment/(rad/s) | -2305.390999 | -2862.446165 |
| dM_pitch/dq | moment/(rad/s) | -1697.457910 | -3346.379337 |
| dM_yaw/dr | moment/(rad/s) | -1146.788679 | -1386.096742 |

Force derivatives:

| Derivative | Проект Ескапе | Saab JAS 39 Gripen2 |
|---|---:|---:|
| dF/dAlpha | (-3.169307, 32374.472054, 5378.600579) | (-74.449420, 39962.844003, 7053.571589) |
| dF/dBeta | (-13752.230125, -86.796351, 542.763048) | (-13320.414397, 1399.732117, 759.330910) |

Cross-rate derivatives:

| Derivative | Проект Ескапе | Saab JAS 39 Gripen2 |
|---|---:|---:|
| dM_pitch/dr | -5.493533 | -348.653880 |
| dM_pitch/dp | 0.804993 | -117.077678 |
| dM_yaw/dq | -0.159004 | -22.296156 |
| dM_yaw/dp | 153.021311 | 335.064909 |
| dM_roll/dq | -0.078744 | 2.438100 |
| dM_roll/dr | -71.181328 | -273.247541 |

## 9. q and r sweeps

Corresponding pitch moment across the q sweep:

| q, rad/s | Проект Ескапе M_pitch | Gripen M_pitch |
|---:|---:|---:|
| -0.50 | 680.195764 | 1596.502117 |
| -0.25 | 255.831286 | 759.907283 |
| -0.10 | 1.212600 | 257.950383 |
| 0 | -168.533191 | -76.687551 |
| +0.10 | -338.278982 | -411.325485 |
| +0.25 | -592.897669 | -913.282385 |
| +0.50 | -1017.262146 | -1749.877219 |

Corresponding yaw moment across the r sweep:

| r, rad/s | Проект Ескапе M_yaw | Gripen M_yaw |
|---:|---:|---:|
| -0.50 | 578.707344 | 508.809569 |
| -0.25 | 292.010174 | 162.285383 |
| -0.10 | 119.991872 | -45.629128 |
| 0 | 5.313004 | -184.238802 |
| +0.10 | -109.365863 | -322.848477 |
| +0.25 | -281.384165 | -530.762988 |
| +0.50 | -568.081335 | -877.287174 |

В sampled range соответствующие moments практически affine относительно rate; значения выше являются прямыми solver outputs, без fit.

## 10. Top blade contributors

`M0` ниже — baseline moment, projected на axis выбранной derivative. `share` — signed percentage of total derivative.

### Проект Ескапе: dM_pitch/dq

| GUID | ID | Position | flipped | M0 | derivative | share |
|---|---:|---|---|---:|---:|---:|
| 63b1d34a-7cb8-4afa-b9cb-d995f679231d | 26 | (-0.399,-2.670,5.695) | false | -479.841 | -216.527 | 12.756% |
| a5dffba6-c19d-41a3-9260-0dd15d924d39 | 26 | (0.399,-2.670,5.695) | true | -479.841 | -216.527 | 12.756% |
| 6f9dab7a-27c2-43a1-975c-672823f0de9d | 26 | (-0.399,-2.130,5.695) | true | 479.222 | -215.607 | 12.702% |
| 6f9ba078-a974-49ee-b800-ea9e234c49a9 | 26 | (0.399,-2.130,5.695) | false | 479.222 | -215.607 | 12.702% |
| fdc82e25-3b27-4bef-98e4-915aa397c392 | 55 | (0.761,-2.410,-3.181) | true | -10.140 | -113.010 | 6.658% |
| d734700c-c22c-47c7-a612-067b509be18e | 55 | (-0.761,-2.410,-3.181) | false | -10.140 | -113.010 | 6.658% |
| 745015d8-0ecb-4859-b469-899bd4c2cd8c | 55 | (0.836,-2.408,-2.583) | true | -8.046 | -72.655 | 4.280% |
| 61b24936-5326-4aa7-869e-13800928da8e | 55 | (-0.836,-2.408,-2.583) | false | -8.046 | -72.655 | 4.280% |
| 63aa09ba-2108-4f01-8735-21452cae57cc | 26 | (3.719,-2.562,2.060) | true | -139.797 | -62.100 | 3.658% |
| 296ec3e2-f9a9-42b9-bc4e-9100525fa98a | 26 | (-3.719,-2.562,2.060) | false | -139.797 | -62.100 | 3.658% |

### Проект Ескапе: dM_yaw/dr

| GUID | ID | Position | flipped | M0 | derivative | share |
|---|---:|---|---|---:|---:|---:|
| 6f9ba078-a974-49ee-b800-ea9e234c49a9 | 26 | (0.399,-2.130,5.695) | false | -309.194 | -206.301 | 17.989% |
| a5dffba6-c19d-41a3-9260-0dd15d924d39 | 26 | (0.399,-2.670,5.695) | true | -309.195 | -206.301 | 17.989% |
| 6f9dab7a-27c2-43a1-975c-672823f0de9d | 26 | (-0.399,-2.130,5.695) | true | 309.186 | -206.290 | 17.988% |
| 63b1d34a-7cb8-4afa-b9cb-d995f679231d | 26 | (-0.399,-2.670,5.695) | false | 309.186 | -206.290 | 17.988% |
| 64211d61-de06-4454-9f40-b9f873fcb32b | 55 | (0,-2.095,-3.481) | true | -11.109 | -135.676 | 11.831% |
| c62f2806-f298-46fc-88c3-7b8da325b1ea | 55 | (0,-2.073,-2.871) | true | 49.535 | -90.826 | 7.920% |
| 7c1919e5-ae3d-4068-bea2-f3322d170349 | 55 | (0,-1.919,-2.041) | false | -33.223 | -43.472 | 3.791% |
| 74a3f440-b384-4a39-962b-362285c65a20 | 26 | (0.576,-2.670,-1.342) | false | 0.000 | -8.283 | 0.722% |
| e4073d17-02a5-45b5-853c-05acf7540071 | 26 | (0.526,-2.130,-1.342) | true | -0.000 | -8.283 | 0.722% |
| d89fe352-670b-4714-9670-86057c1ea4a0 | 26 | (-0.526,-2.130,-1.342) | false | 0.000 | -8.283 | 0.722% |

### Gripen: dM_pitch/dq

| GUID | ID | Position | flipped | M0 | derivative | share |
|---|---:|---|---|---:|---:|---:|
| 81b1bc03-151a-46a5-8b88-fd5172b0936f | 55 | (5.217,1.543,5.547) | false | 249.649 | -271.309 | 8.108% |
| fd633b8c-43ad-4337-9f54-d3fe10d9ec78 | 55 | (7.283,1.543,5.547) | true | 249.649 | -271.309 | 8.108% |
| c8d47248-3a3a-4cc9-a8f1-7b4b48eb26a2 | 55 | (5.407,0.632,-3.388) | false | 12.370 | -187.010 | 5.588% |
| 834c5cef-f8db-4fb1-bc33-97c5eaec53af | 55 | (7.093,0.632,-3.388) | true | 12.370 | -187.010 | 5.588% |
| b965e2ff-e56c-4186-bb21-322477ac8d8a | 55 | (3.000,1.200,-2.972) | false | -0.738 | -176.495 | 5.274% |
| 4e2c8563-17ae-48cf-b72a-4b85a9b730e3 | 55 | (9.500,1.200,-2.972) | true | -0.739 | -176.495 | 5.274% |
| 98e5d796-edc5-48ce-a333-edbfdc64ddfe | 55 | (9.864,1.200,-2.938) | false | -0.731 | -173.307 | 5.179% |
| 59818498-43bb-4d0f-830c-f8386d67ab7c | 55 | (2.636,1.200,-2.938) | true | -0.733 | -173.307 | 5.179% |
| ab7fb490-e7b4-4c2c-a9a8-0d6bd08d3e3e | 55 | (5.217,1.583,4.598) | false | 198.541 | -172.644 | 5.159% |
| cb192556-2285-4690-a4b9-e96a25d9c851 | 55 | (7.283,1.583,4.598) | true | 198.541 | -172.644 | 5.159% |

### Gripen: dM_yaw/dr

| GUID | ID | Position | flipped | M0 | derivative | share |
|---|---:|---|---|---:|---:|---:|
| b6834832-2ecc-4a1b-8e1b-dd1848352a34 | 55 | (6.250,2.558,-4.072) | true | -12.357 | -288.845 | 20.839% |
| 20fbda5d-3907-44f3-9d7f-4f76ec19dc50 | 55 | (6.250,2.528,-3.622) | true | -83.296 | -238.122 | 17.179% |
| 5761008b-7534-48a5-8b04-492fca9deb1b | 55 | (6.250,3.128,-3.572) | true | -82.350 | -232.739 | 16.791% |
| 172543bb-29a1-4122-85c4-3312dc7bd62e | 55 | (6.943,0.882,-4.188) | false | -1174.982 | -170.801 | 12.322% |
| f3a2dcdf-8952-4ff0-bdc9-f11029d5396a | 55 | (5.557,0.882,-4.188) | true | 1171.643 | -169.586 | 12.235% |
| 4ea7e9e0-03af-443b-97a9-db82a382edb0 | 55 | (6.499,1.959,3.045) | true | -5.367 | -50.677 | 3.656% |
| 32484b63-0f87-4fdd-bcc4-6c38efd9179c | 55 | (6.006,1.959,3.045) | false | 5.367 | -50.671 | 3.656% |
| 6d67b975-d5d5-4e1a-9207-1eed31cbb4ed | 55 | (6.006,1.959,2.495) | true | -93.898 | -29.484 | 2.127% |
| 3cd9b25a-2a47-41de-aaca-db6010e104f6 | 55 | (6.499,1.959,2.495) | false | 93.841 | -29.412 | 2.122% |
| c8d47248-3a3a-4cc9-a8f1-7b4b48eb26a2 | 55 | (5.407,0.632,-3.388) | false | -8.671 | -28.379 | 2.047% |

## 11. Answer to the damping question

В восстановленной blade model на этом operating point все три главные rate derivatives отрицательны для обеих машин в зафиксированной convention.

Гипотеза «у Эскапе rotational damping сильнее» этими raw derivatives **не подтверждается**:

- `|dM_pitch/dq|`: Eskapie `1697.46`, Gripen `3346.38`;
- `|dM_yaw/dr|`: Eskapie `1146.79`, Gripen `1386.10`;
- `|dM_roll/dp|`: Eskapie `2305.39`, Gripen `2862.45`.

У Eskapie основной pitch/yaw damping сильно сконцентрирован в четырёх id=26 blades около `z=5.695`. У Gripen pitch damping распределён между большим числом id=55 blades, а yaw damping преимущественно создают blades около `z=-3.6..-4.2`. Это описание численных вкладов, не оценка качества машины.

## 12. Provenance and remaining assumptions

VERIFIED в текущем PoC:

- неизменённая recovered vanilla AxialDrag law, blade angles, AxisDrag и velocity cap;
- BSG blade transforms/flipped parsing;
- machine-axis projection и `omega=(q,r,p)` mapping;
- alpha/beta velocity formula и сохранение speed;
- central difference implementation;
- per-blade contribution sum;
- synthetic restoring/damping signs и mirrored symmetry;
- одинаковый AnalysisState/steps в compare mode.
- BuildSurface id=73 `bmt-aero` и material gating (`wood` aerodynamic, `glass` non-aerodynamic);
- BuildSurface corner force law, squared-speed cap `90000`, wood multiplier `0.0002500000118743628`, `AddForceAtPosition` moment and per-corner `F·u` power;
- BSG reconstruction of triangle/quad BuildSurface geometry from ordered BuildEdge/BuildNode links, including curved-edge interpolation, generated area and corner normals;
- separate Blade / BuildSurface / Total force, moment and power totals throughout derivatives, sweeps and Plot Lab.

HEURISTIC:

- aircraft component обеих машин выбран spatial-proximity heuristic с blade-count priority;
- excluded clusters не доказаны runtime joint graph.

APPROXIMATE / runtime-dependent:

- CG использует versioned prefab masses и block-root COM fallback;
- BuildSurface runtime masses неизвестны точно;
- Spring/Rope child Rigidbody topology неизвестна без runtime data;
- точные runtime COM/joints/physical components не известны;
- moments и derivatives зависят от approximate CG;
- blade force application point остаётся BSG block-root position.
- BuildSurface uses one rigid-body state reconstructed from the selected AnalysisGroup; individual runtime Rigidbody velocities, broken state, joint constraints and PhysX multibody behavior are not reproduced.

For the checked `Проект Ескапе.bsg` and `Saab JAS 39 Gripen2.bsg`, all reconstructable BuildSurfaces are inactive for aerodynamics after material gating (respectively `0/6` and `0/16` active). Their previously documented blade-only numeric results therefore remain unchanged.

Отрицательная damping derivative означает opposing moment только в зафиксированной sign convention. Этот этап не использует inertia, поэтому не делает выводов об angular acceleration, time response или субъективной «плавности» управления.
