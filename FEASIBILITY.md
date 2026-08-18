# FEASIBILITY STUDY: локальный анализатор самолётов Besiege по `.bsg`

Дата исследования: 2026-08-17

Исследованная игра: Besiege `1.90-25346`, Steam build `24131898`, Unity `5.4.0f3`

Современный формат сохранения в исследованной версии: `bsgVersion="1.4"`

## 1. Краткий вывод

**Проект реализуем.** Причём его наиболее важная часть — статический анализ vanilla-лопастей — выглядит лучше, чем можно было предположить до исследования.

Из реального `.bsg` надёжно извлекаются список блоков, их GUID и числовые ID, machine-local position, quaternion rotation, scale, skin, типизированные block-specific data и key mappings. Vanilla-лопасти определяются без эвристики: `id=26` — `Propeller`, `id=55` — `SmallPropeller`. Поле `flipped` сохраняется в `.bsg` и меняет физическую ориентацию лопасти.

В установленной версии удалось восстановить непосредственно из `Assembly-CSharp.dll` и Unity prefabs фактическую базовую формулу силы этих лопастей. Это не стандартная аэродинамика и не придуманная аппроксимация. В обычном воздушном режиме код берёт скорость Rigidbody, проецирует её на локальную ось, отклонённую примерно на `±23°`, умножает на квадрат полной скорости с cap `30`, а силу прикладывает вдоль другой — базовой — оси лопасти. Несовпадение оси измерения скорости и оси силы позволяет работе силы `F·v` становиться положительной в некоторых режимах. Это даёт правдоподобный кодовый механизм для наблюдения, что одна ориентация лопастей может разгонять машину в манёвре, а противоположная — тормозить.

Поэтому без запуска полной физики игры можно построить быстрый инструмент, который хорошо объясняет:

- где находятся лопасти и куда направлены их рабочие оси;
- какие силы и моменты они создают при заданных `V`, angle of attack, sideslip и `p/q/r`;
- как меняются pitch/yaw/roll stability derivatives и rotational damping;
- почему изменение расположения или `flipped` даёт иной момент и иной обмен энергией;
- почему при одинаковом управляющем моменте самолёты с разной инерцией начинают вращаться по-разному.

Но инструмент не будет точным заменителем Besiege/PhysX для:

- автоматического восстановления всех реальных joints только из XML;
- упругости, люфтов, разрушения и перестройки многотельной машины;
- точной работы шарниров под нагрузкой;
- отрыва блоков;
- поведения модифицированных блоков без соответствующих модов;
- долгой нелинейной control-response simulation без калибровки в игре.

Итоговый реалистичный продукт — это **versioned static/dynamic approximation tool**, а не полный эмулятор Besiege. Для целевого вопроса этого достаточно: первый порядок различий между стабильным и резким самолётом можно объяснять численно через `force/moment + CG/inertia + damping`. Деформации, joints и разрушение должны показываться как отдельная зона неопределённости.

## 2. Статусы утверждений

В отчёте используются четыре статуса:

- **VERIFIED** — подтверждено реальными `.bsg`, managed assembly или Unity asset исследованной установки.
- **INFERRED** — следует из подтверждённых данных и обычной механики, но ещё не сверено измерением в игре.
- **UNKNOWN** — имеющихся данных недостаточно.
- **REQUIRES EXPERIMENT** — нужна инструментированная проверка непосредственно в Besiege.

Статус относится к Besiege `1.90-25346`. Формат, prefabs и физические коэффициенты следует привязывать к версии/хэшу игры.

## 3. Источники и воспроизводимость

### 3.1 Локальные первичные источники

Исследованы:

1. `431` реальный `.bsg` из `Besiege_Data/SavedMachines`; все `431` разобрались как XML без ошибки.
2. Четыре свежих самолёта как основные fixtures:

   - `Сухой Су-33.bsg`: 875 блоков, 24 `Propeller`, 91 `SmallPropeller`;
   - `Проект Ескапе.bsg`: 230 блоков, 14 `Propeller`, 23 `SmallPropeller`;
   - `MiG-31.bsg`: 298 блоков, 8 `Propeller`, 34 `SmallPropeller`;
   - autosave `Saab JAS 39 Gripen2`: 316 блоков, 0 `Propeller`, 41 `SmallPropeller`.

3. `Besiege_Data/Managed/Assembly-CSharp.dll`, SHA-256:

   `BECEA5E934C0D1AB0C0D0428DB53000E245997BA9761581D45F13BD168AE1ABF`

4. Методы и типы текущей игры:

   - `BlockType`;
   - `XmlLoader.LoadFromXmlDocument`;
   - `XmlSaver.Save`;
   - `BlockInfo.FromBlockBehaviour`;
   - `Machine.SpawnBlock`, `Machine.FindLinks`, `Machine.UpdateMass`, `Machine.CalculateCOM`;
   - `SaveableDataHolder.SaveMapperValues`;
   - `PropellorController.CheckFlipDirection`, `OnSave`, `OnLoad`;
   - `AxialDrag.FixedUpdateBlock`;
   - `SteeringWheel`;
   - `BuildEdgeBlock.WriteData`.

5. Unity serialized assets:

   - `Besiege_Data/level0` — vanilla block prefabs, Rigidbody, joints и MonoBehaviour data;
   - `Besiege_Data/sharedassets0.assets` — meshes, на которые ссылаются prefabs.

6. `Besiege_Data/output_log.txt`, где текущий запуск сообщает `version: 1.90-25346` и Unity `5.4.0f3`.

Unity assets читались read-only. В игру и пользовательские машины изменения не вносились.

### 3.2 Статистика корпуса `.bsg`

**VERIFIED**:

- файлов: `431`;
- блоков суммарно: `125314`;
- `bsgVersion=1.3`: `52` файла;
- `bsgVersion=1.4`: `379` файлов;
- файлов с `id=26`: `144`;
- файлов с `id=55`: `153`;
- экземпляров `id=26`: `2427`;
- экземпляров `id=55`: `4176`;
- у всех 6603 исследованных vanilla-лопастей присутствовал Boolean `flipped`;
- в данных встретились типы `Boolean`, `Color`, `Integer`, `Single`, `SingleArray`, `String`, `StringArray`, `Vector3`.

Наличие `bsgVersion=1.3` означает, что parser не должен жёстко принимать только 1.4. Текущий `XmlSaver` сохраняет 1.4.

## 4. Что реально находится внутри современного `.bsg`

### 4.1 Контейнер и корневая структура

**VERIFIED**: `.bsg` — обычный UTF-8 XML, а не архив и не бинарный protobuf.

Упрощённая структура реального файла:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Machine version="1" bsgVersion="1.4" name="..." Auth="...">
  <Global>
    <Position x="0" y="5.05" z="0" />
    <Rotation x="0" y="0" z="0" w="1" />
  </Global>
  <Data>
    <StringArray key="requiredMods" />
  </Data>
  <Blocks>
    <Block id="55" guid="...">
      <Transform>
        <Position x="..." y="..." z="..." />
        <Rotation x="..." y="..." z="..." w="..." />
        <Scale x="1" y="1" z="1" />
      </Transform>
      <Settings>
        <Skin name="..." id="..." />
      </Settings>
      <Data>
        <Boolean key="flipped">True</Boolean>
        <!-- mapper values и произвольные данные блока -->
      </Data>
    </Block>
  </Blocks>
</Machine>
```

Корневые элементы во всех 431 файлах: `Global`, `Data`, `Blocks`. У каждого блока были `Transform` и `Data`; `Settings` присутствовал не всегда.

### 4.2 Идентификация блоков

**VERIFIED**:

- `Block/@id` — числовой runtime/vanilla block type;
- `Block/@guid` — уникальный GUID экземпляра;
- vanilla enum текущей игры содержит ID `0..103`;
- `26 = Propeller`;
- `55 = SmallPropeller`;
- modded blocks дополнительно имеют `modId` и `localId`; serializer также поддерживает `fallback`.

Реальный modded-пример имел форму:

```xml
<Block id="1000"
       guid="..."
       modId="33989506-e12a-4614-81c9-7ad8211d2e23"
       localId="1">
```

**VERIFIED**: для modded block нельзя считать `id=1000` глобально стабильным. Устойчивый ключ — `(modId, localId)` плюс fallback. Parser обязан сохранять неизвестные атрибуты и XData, даже если приложение не понимает их семантику.

### 4.3 Transform semantics

**VERIFIED** по `Machine.SpawnBlock`:

- `Block/Transform/Position` — position в локальной системе машины;
- `Block/Transform/Rotation` — локальный quaternion `(x,y,z,w)`;
- `Scale` — локальный scale блока;
- `Global/Position` и `Global/Rotation` задают transform машины.

Игра создаёт блок примерно так:

```text
worldPosition = machineTransform.TransformPoint(blockLocalPosition)
worldRotation = machineWorldRotation * blockLocalRotation
```

Следовательно, 3D-компоновку корневых transforms можно восстановить точно. Нельзя преобразовывать quaternion в Euler и обратно как основной путь: это внесёт лишние неоднозначности и ошибки.

### 4.4 Block-specific data и controls

**VERIFIED**: `Data` — типизированный key-value container (`XDataHolder`). `BlockBehaviour.OnSave` вызывает `SaveMapperValues`, поэтому настройки Block Mapper и keys попадают сюда.

В реальных файлах найдены, например:

- steering hinge: `bmt-left`, `bmt-right`, `bmt-rotation-speed`, `bmt-tension`, `bmt-autoReturn`, `bmt-uselimits`, `bmt-limits`, `flipped`;
- blade: `flipped` и, при установленных mods, дополнительные `bmt-*` keys;
- ballast: `bmt-mass`;
- spring/rope: control keys, length, point mass и endpoint transforms;
- Build Edge: `start`, `end` с GUID узлов;
- Build Surface: `edges`;
- modded blocks: произвольные собственные keys.

Ключи `bmt-*` не следует автоматически считать только данными стороннего мода: этим же prefix пользуется vanilla mapper serialization. Семантика зависит от типа блока и версии.

### 4.5 Connections и joints

Ответ неоднороден.

**VERIFIED — явно присутствует в `.bsg`:**

- Brace (`id=7`): `start-position`, `end-position`, `start-rotation`, `end-rotation`;
- Spring (`id=9`): endpoint transforms;
- Rope Winch (`id=45`): endpoint transforms;
- Build Edge (`id=72`): GUID `start` и `end`;
- Build Surface (`id=73`): список `edges`;
- параметры hinge и его control mappings.

**VERIFIED — общего списка joints нет:** `XmlSaver` пишет blocks и их XData, но не сериализует универсальный граф `body A ↔ joint ↔ body B`. После загрузки `MachineAnalyzer` вызывает `Machine.FindLinks`; игра восстанавливает обычные соединения пространственно через prefab geometry, colliders и adding/joint triggers.

Вывод:

- специальные механизмы частично описаны явно;
- обычный структурный attachment graph нельзя достать из XML одним чтением GUID;
- его можно попытаться воспроизвести, если иметь collider/adding-point database и повторить game linking rules;
- самый надёжный путь для control graph — небольшой in-game exporter, который после загрузки машины выгружает фактические Rigidbody/Joints.

## 5. Достаточно ли `.bsg` для 3D-реконструкции

### 5.1 Компоновка

**VERIFIED: да.** Для каждого блока известны type reference, local transform и skin reference. Этого достаточно для точного расположения block roots и инженерного viewer с условной геометрией.

### 5.2 Точная форма

**VERIFIED: нет, не из одного `.bsg`.** В `.bsg` нет vertices, triangles, collider shapes, child transforms визуала или physical center of mass.

Для точной vanilla-геометрии нужны:

- meshes из Unity assets;
- prefab child transforms;
- collider descriptions;
- selected skin/material assets;
- procedural rules для Build Edge/Surface, braces, ropes и других растягиваемых объектов.

На примере лопастей подтверждено:

- root prefab находится в `level0`;
- визуальный child `Vis` имеет дополнительный rotation и scale;
- mesh хранится во внешнем `sharedassets0.assets`;
- большая лопасть ссылается на mesh с 632 vertices;
- малая — на mesh с 465 vertices.

Применить только BSG quaternion к «примерной плоскости» достаточно для инженерного overlay, но не для визуально точной модели.

### 5.3 Практические варианты

1. **Условные primitives — рекомендуемый MVP.** Простые boxes/lines/blade glyphs. Не требует распространения игровых assets.
2. **Локальное извлечение assets.** Desktop-приложение читает установленную пользователем Besiege и создаёт versioned geometry database/glTF cache.
3. **Заранее подготовленная база.** Технически проще для browser build, но распространение proprietary meshes требует отдельной проверки разрешений.

Для workshop skins и modded blocks потребуются соответствующие workshop/mod assets. При их отсутствии viewer должен показывать placeholder, а не придумывать форму.

## 6. Масса, CG и inertia

### 6.1 Где брать реальные массы блоков

**VERIFIED**: у 101 из 103 найденных vanilla block prefabs в `level0` есть `Rigidbody.m_Mass`; `BuildNode` и `BuildEdge` не имеют собственного Rigidbody. Таким образом, первичный источник default mass — prefab текущей версии игры.

Дополнительный кодовый источник — runtime:

```text
PrefabMaster.BlockPrefabs[id]
  .gameObject.GetComponent<Rigidbody>().mass
```

Наиболее надёжный production-процесс — C# calibration/export mod, который один раз для каждой поддерживаемой версии сохраняет:

- ID и имя;
- default mass;
- `Rigidbody.centerOfMass`;
- `inertiaTensor` и `inertiaTensorRotation`;
- collider descriptors;
- joint break force/torque;
- aero component parameters и local axis transforms.

**VERIFIED для текущих prefabs:** обе лопасти имеют default mass `0.3`.

### 6.2 Почему default mass недостаточно

**VERIFIED** по `.bsg` и managed code: некоторые блоки меняют mass через mapper/runtime logic.

Примеры:

- Ballast меняет mass через `bmt-mass`;
- Build Surface имеет custom mass;
- springs/ropes имеют point-mass logic;
- fuel blocks меняют массу с количеством топлива;
- отдельные scale/length blocks пересчитывают массу;
- сторонние mods могут принудительно менять mass, colliders или passive state.

Обычный произвольный transform scale сам по себе не гарантирует кубического пересчёта массы: нужен block-specific handler. Нельзя использовать правило `mass ∝ scale.x*scale.y*scale.z` для всех блоков.

`Machine.UpdateMass` текущей игры суммирует массы Rigidbody building blocks, пропуская блоки без Rigidbody. Для начальной статической машины этот подход можно повторить, если правильно воспроизвести все mass overrides.

### 6.3 Можно ли вычислить настоящий CG

Ответ по уровням точности:

- **VERIFIED:** `.bsg` не содержит готовый физический CG.
- **INFERRED, высокая полезность:** по `.bsg` + versioned database `{mass, local COM}` можно вычислить mass-weighted CG статической конфигурации.
- **REQUIRES EXPERIMENT для game-exact:** local COM лучше экспортировать из уже созданного Unity Rigidbody, особенно для сложных и scaled colliders.

Формула агрегата:

```text
CG = Σ(m_i * r_i) / Σ(m_i)
```

Важно: `Machine.CalculateCOM` в game assembly не является чистым физическим aggregate CG. Метод использует `GetCenter`, renderer/collider bounds, специальные исключения и отдельную логику для surface/dragged blocks. Это, вероятно, machine center для игровых/UI задач. Для инженерного анализатора следует явно различать:

- `Besiege machine center` — если понадобится воспроизвести соответствующий игровой метод;
- `physical aggregate CG` — mass-weighted `Rigidbody.worldCenterOfMass`.

В многотельной машине нет одного неизменного CG после движения шарниров или разрушения. Анализатор должен указывать конфигурацию, для которой посчитан CG.

### 6.4 Можно ли вычислить Ixx/Iyy/Izz

**INFERRED: да, достаточно полезно; game-exact — сложно.**

Если для каждого блока известны full local inertia tensor `I_i`, mass и local COM, агрегат в выбранных machine axes считается через rotation и теорему Штейнера:

```text
I_total = Σ( R_i I_i R_iᵀ
           + m_i * ((r_i·r_i) E - r_i r_iᵀ) )
```

После этого можно вывести `Ixx`, `Iyy`, `Izz` и products of inertia. Показывать только три диагонали без выбранной системы координат недостаточно.

Три режима точности:

1. **Point masses.** Игнорировать собственную инерцию блока. Быстро; для большой машины, где плечи доминируют, уже полезно.
2. **Primitive collider model.** Box/sphere/capsule/mesh approximations. Хороший инженерный уровень.
3. **Runtime-exported PhysX tensor.** Лучший путь к совпадению с игрой для конкретной версии и scale.

Основная проблема не формула, а получение game-equivalent per-block tensor и корректная трактовка многотельных joints. Для «locked intact configuration» задача решаема. Для гибкой/двигающейся машины один tensor уже не описывает всю динамику.

## 7. Vanilla aerodynamic propellers

### 7.1 Идентификация

**VERIFIED:**

| BSG ID | Enum | Роль в анализаторе |
|---:|---|---|
| 26 | `Propeller` | large aerodynamic propeller |
| 55 | `SmallPropeller` | small aerodynamic propeller |

Для vanilla blocks эвристика по имени, mesh или размеру не нужна. Для modded aerodynamic blocks автоматическое распознавание без mod metadata остаётся **UNKNOWN**.

### 7.2 Ориентация и `flipped`

**VERIFIED**:

- BSG rotation — quaternion block root;
- `PropellorController.OnSave` сохраняет Boolean `flipped`;
- `OnLoad` восстанавливает его;
- `CheckFlipDirection` меняет знак Z-угла child transform `liftNormal`;
- физический `liftNormal` vanilla prefabs отклонён примерно на 23°.

Из текущих assets:

| Параметр | Propeller | SmallPropeller |
|---|---:|---:|
| Default mass | 0.3 | 0.3 |
| `AxisDrag` | `(0, 0.015, 0)` | `(0, 0.015, 0)` |
| `velocityCap` | 30 | 30 |
| `liftNormal` angle | ~23.069° | ~22.845° |
| Prefab joint break force | 6187 | 6187 |
| Prefab joint break torque | 6187 | 6187 |

Следовательно, world axes можно вычислить точно для поддерживаемой версии:

```text
Qb = Qmachine * Qblock
forceAxis   = Qb * localY
senseAxis   = Qb * RotZ(sign(flipped) * theta) * localY
```

Точный знак лучше хранить как результат prefab transform/`flipped`, а не называть заранее «forward» или «backward». Сам `.bsg` не содержит семантического «нос машины». Пользователь или отдельный detector должен задать machine forward/up axes; после этого категории horizontal/vertical и forward/backward становятся производными от dot products.

### 7.3 Восстановленная формула силы

Ниже — **VERIFIED** описание normal-air branch `AxialDrag.FixedUpdateBlock` для текущих vanilla propellers.

Игра делает по смыслу:

```text
v       = bladeRigidbody.velocity
vLocal  = liftNormal.InverseTransformDirection(v)
xyz     = -Vector3.Scale(vLocal, AxisDrag)
s2      = min(|v|², velocityCap²)
bladeRigidbody.AddRelativeForce(xyz * s2)
```

Так как `AxisDrag=(0, 0.015, 0)`, формулу удобно записать:

```text
F_world = Qb * (0, -0.015 * dot(v, senseAxis) * min(|v|², 30²), 0)
```

или

```text
F_world = -0.015 * dot(v, senseAxis) * min(|v|², 900) * forceAxis
```

Здесь есть принципиальная особенность: `senseAxis` и `forceAxis` различаются примерно на 23°. Это не обычный drag, направленный строго против скорости.

Следствия:

- ниже скорости 30 magnitude ведёт себя как projected velocity × speed², то есть в общем случае кубически по масштабу скорости;
- выше 30 множитель speed² capped at 900, поэтому дальнейший рост по projected velocity становится линейным;
- `flipped` меняет `senseAxis`, но не базовую `forceAxis`;
- сила прикладывается через `Rigidbody.AddRelativeForce`, без явного `position`, то есть к center of mass Rigidbody лопасти;
- в этом branch нет проверки occlusion, raycast или экранирования соседними блоками.

Это подтверждает рабочее наблюдение, что лопасти действуют внутри других блоков.

### 7.4 Почему возможен gain/loss энергии

**INFERRED непосредственно из VERIFIED формулы:**

```text
power_i = F_i · v_i
```

Поскольку `F_i` направлена по `forceAxis`, а знак задаётся проекцией на другую `senseAxis`, `F_i·v_i` не обязано быть всегда отрицательным. В некоторых комбинациях ориентации и локальной скорости оно положительно. Поэтому energy gain/loss можно считать численно без добавления выдуманного коэффициента.

Это сильный кандидат на объяснение различия forward/backward-oriented blades. Однако пользовательские термины forward/backward надо сопоставить с конкретным знаком `flipped` и выбранной осью самолёта экспериментом на одном эталонном блоке.

### 7.5 Скорость лопасти при вращении

Код использует `bladeRigidbody.velocity`. Для intact rigid approximation:

```text
v_i = V_CG + ω × r_i
```

**INFERRED:** подстановка этой скорости в восстановленную формулу естественно создаёт pitch/yaw/roll damping, зависящий от плеча лопасти. Это именно тот механизм, который нужен для анализа распределения вертикальных и горизонтальных лопастей.

В самой игре лопасти — отдельные Rigidbody, связанные joints. При деформации их скорость может отличаться от rigid approximation; это уже **REQUIRES EXPERIMENT** или simplified multibody model.

### 7.6 Большие и малые лопасти

**VERIFIED для 1.90:** у большой и малой лопасти одинаковые default mass, `AxisDrag`, speed cap и prefab joint break limits. Они различаются mesh/collider geometry и имеют немного разный prefab angle.

Следовательно, наблюдение «большие чаще отрываются на скорости» нельзя честно объяснить отдельным большим aero coefficient или меньшим serialized break force — таких различий в исследованных prefabs нет. Возможные причины — геометрия, local COM/lever, attachment layout, collision/joint loads или модификации. Это **REQUIRES EXPERIMENT**.

## 8. Stability, damping, control response и энергия

### 8.1 Силы и моменты

При известных CG, blade-body COM и состоянии:

```text
F_total = Σ F_i
M_total = Σ ((r_i - CG) × F_i)
```

**INFERRED, высокая уверенность:** это даст полезные `Fx/Fy/Fz`, pitch/yaw/roll moments и per-blade vectors для intact rigid configuration.

### 8.2 Stability derivatives

**INFERRED:** derivatives можно получать численно центральными разностями или аналитически из blade law:

- `∂M_pitch/∂α`;
- `∂M_yaw/∂β`;
- `∂M_roll/∂β`;
- `∂M_pitch/∂q`;
- `∂M_yaw/∂r`;
- `∂M_roll/∂p`;
- при необходимости полную Jacobian `∂(F,M)/∂(u,v,w,p,q,r)`.

Интерфейс должен показывать численное значение, единицы, operating point, step finite difference и coordinate convention. Категории stable/unstable могут быть вторичным выводом по знаку производной.

### 8.3 Initial angular acceleration

Для агрегированной rigid model:

```text
ωdot = I⁻¹ (M - ω × (Iω))
```

При `ω=0`:

```text
ωdot_initial = I⁻¹ M_control
```

**INFERRED:** это хороший численный показатель «насколько мгновенно самолёт начинает вращаться». Он напрямую разделяет control moment и inertia.

### 8.4 Steady angular rate и response over time

**INFERRED, приблизительно:** если control geometry известна, можно интегрировать rigid-body ODE с blade forces. Damping law позволит получить характерную установившуюся rate или решить `M_control + M_aero(ω)=0` при фиксированной скорости.

Но точная траектория требует дополнительно:

- изменения translational velocity;
- gravity/thrust;
- движения hinge до заданного угла;
- joint compliance и деформации;
- других drag/aero blocks;
- возможного разрушения.

Поэтому initial acceleration и local damping — надёжнее, чем long-horizon turn rate.

### 8.5 Energy gain/loss

**INFERRED, для blade subsystem:**

```text
P_blades = Σ(F_i · v_i)
ΔE_blades = ∫ P_blades dt
```

Это можно показывать как signed power at operating point и интеграл в упрощённой симуляции.

**UNKNOWN без расширенной модели:** полная энергия машины, потому что в неё входят motors, jets, gravity, collision losses, joint work, other drag и разрушение.

## 9. Можно ли определить лопасти на управляющих механизмах

### 9.1 Что известно статически

**VERIFIED:** BSG содержит hinge position/rotation/scale, keys, speed, tension, limits, auto-return и `flipped`. Для других растягиваемых механизмов присутствуют endpoints. Этого достаточно, чтобы увидеть потенциальные actuators.

### 9.2 Чего не хватает

**VERIFIED:** универсального serialized joint graph нет. Нельзя надёжно сказать «эта лопасть является потомком этого hinge» только потому, что она рядом или использует ту же клавишу.

Варианты:

1. **INFERRED heuristic:** proximity + orientation + shared key. Быстро, но будут ложные связи.
2. **INFERRED geometry reconstruction:** повторить adding points/collider triggers и `Machine.FindLinks`. Реализуемо, но сложно и version-dependent.
3. **VERIFIED-runtime export — рекомендуемый путь:** in-game calibration mod загружает `.bsg` и выгружает реальные Rigidbody/Joints/connectedBody и block GUID mapping.

После получения graph можно виртуально отклонять hinge и все блоки соответствующей moving subassembly, затем пересчитывать blade forces. Без graph control authority следует считать `UNKNOWN`, а не угадывать.

## 10. Что невозможно получить статически только из `.bsg`

### UNKNOWN или REQUIRES EXPERIMENT

- фактические runtime `Rigidbody.centerOfMass` и `inertiaTensor` после всех prefab/block handlers;
- универсальный joint graph для обычных attachments;
- solver state, joint stress, flex и backlash;
- реальный angle hinge под аэродинамической нагрузкой;
- break moment и место разрушения всей конструкции;
- состояние топлива после начала симуляции;
- damage, burn, detached/disabled blocks;
- velocity каждого отдельного Rigidbody после деформации;
- влияние mod code, если mod отсутствует;
- user-semantic aircraft forward/up;
- соответствие пользовательских слов forward/backward конкретному `flipped` sign;
- полная long-horizon trajectory без симуляции propulsion, gravity и joints.

### Что нужно измерить в Besiege

1. Экспорт per-prefab `mass`, local COM, inertia tensor и colliders при разных scale.
2. Проверка single-blade force sweep по speed/direction и обоим `flipped`.
3. Проверка normal atmosphere против gravity/atmosphere overrides.
4. Проверка rotational sweep на известных радиусах.
5. Экспорт фактического joint graph после загрузки representative aircraft.
6. Hinge step response: commanded key → angle/time под несколькими нагрузками.
7. Break tests большой/малой лопасти с одинаковым креплением.
8. Сравнение predicted per-blade force/moment с runtime acceleration нескольких самолётов.

## 11. Ответы на 16 вопросов feasibility study

| № | Вопрос | Статус | Ответ |
|---:|---|---|---|
| 1 | Что внутри `.bsg` | VERIFIED | UTF-8 XML 1.3/1.4: machine transform, typed machine data, blocks, transforms, settings, typed XData. |
| 2 | IDs/position/rotation/scale/properties/connections/keys | VERIFIED | Всё перечисленное есть, кроме универсального connection graph; специальные endpoints/GUID links частично есть. |
| 3 | Достаточно ли для 3D layout | VERIFIED | Да для block roots и условной геометрии. |
| 4 | Что нужно для точной формы | VERIFIED | Unity meshes, prefab child transforms, colliders, skins, procedural geometry, mod assets. |
| 5 | Где взять mass | VERIFIED | `level0` Rigidbody prefabs или runtime `PrefabMaster` exporter; затем применить block-specific overrides. |
| 6 | Можно ли вычислить CG | INFERRED | Да для статической конфигурации с versioned mass/local-COM database; BSG alone недостаточно. |
| 7 | Можно ли вычислить inertia | INFERRED | Да для locked aggregate при наличии per-block tensors; game-exact multibody inertia сложна. |
| 8 | Автоматически определить propellers | VERIFIED | Да: IDs 26 и 55. |
| 9 | Определить их orientation | VERIFIED | Да: machine/block quaternion + prefab axes + `flipped`. |
| 10 | Найти blades на controls | UNKNOWN из BSG alone | Надёжно — после joint graph export/reconstruction; proximity heuristic недостаточна. |
| 11 | Что нельзя получить статически | VERIFIED/UNKNOWN | Runtime dynamics, stresses, actual joint deflections, break/damage, per-body velocities. |
| 12 | Что восстанавливать экспериментально | REQUIRES EXPERIMENT | COM/inertia calibration, joint graph, hinge response, breaks, end-to-end validation. |
| 13 | Реалистична ли blade approximation | VERIFIED/INFERRED | Да; core vanilla force law уже восстановлен. Approximation нужна главным образом вокруг multibody dynamics/environment. |
| 14 | Быстро ли это для UI | INFERRED, высокая уверенность | Да: O(number of blades), сотни простых vector operations на evaluation. |
| 15 | Stability/damping/initial acceleration/steady rate/energy | INFERRED | Первые три и blade power хорошо реализуемы; steady rate/long response приблизительны. |
| 16 | Надёжное против приблизительного | См. ниже | Parsing/ID/transforms/core blade law надёжны; inertia/control graph/multibody response требуют calibration. |

## 12. Предлагаемый pipeline

```text
.bsg
  → safe XML parser
  → normalized MachineModel
  → versioned BlockAssetDatabase
  → MechanismGraph (explicit + optional runtime export)
  → MassModel / CG / inertia
  → BladeModel
  → Besiege blade-force solver
  → force/moment aggregation
  → stability derivatives / damping
  → control-response approximation
  → 3D + tables + plots + compare/what-if UI
```

### 12.1 Parser layer

- принимать 1.3 и 1.4;
- использовать invariant floating-point parsing;
- валидировать quaternion и GUID, но не «исправлять» молча;
- сохранять unknown attrs и XData losslessly;
- разрешать vanilla key `(id)` и mod key `(modId, localId, fallback)`;
- выдавать warnings по missing mods/unknown block IDs;
- иметь golden tests на реальные BSG.

### 12.2 Normalized MachineModel

Минимальная сущность блока:

```text
BlockInstance {
  guid
  typeRef
  localPosition
  localRotationQuaternion
  localScale
  skinRef?
  rawTypedData
  decodedKnownProperties
  confidence/warnings
}
```

Не следует смешивать XML parser с Three.js scene objects или физикой.

### 12.3 Versioned BlockAssetDatabase

Ключ базы должен включать game version и желательно SHA-256 `Assembly-CSharp.dll`. Содержимое:

- block ID/name;
- mass rules;
- local COM/inertia;
- collider/mesh references;
- force/sense axes;
- coefficients/caps;
- mapper schema;
- procedural geometry handler;
- provenance каждого значения.

### 12.4 Confidence model

Каждый итоговый параметр желательно снабжать источником:

- `exact-from-bsg`;
- `exact-from-versioned-prefab`;
- `runtime-calibrated`;
- `geometry-inferred`;
- `heuristic`;
- `unsupported-modded-block`.

Это лучше скрытого смешивания точных и приближённых чисел.

## 13. Рекомендуемый стек

### Основное приложение

- TypeScript;
- React;
- Vite;
- Three.js;
- typed arrays или небольшой собственный vector/quaternion math layer;
- Web Worker для batch sweeps/compare, хотя MVP, вероятно, будет быстрым и без него;
- uPlot/Plotly/ECharts для численных графиков — выбрать после прототипа.

Предложенный пользователем web stack подходит. Solver для сотен лопастей не требует Python, CFD library или GPU compute.

### Desktop integration

Tauri полезен, когда понадобятся:

- file picker без browser limitations;
- поиск установленной Besiege;
- чтение `level0`/`sharedassets*.assets`;
- локальный asset cache;
- запуск/импорт результатов calibration exporter.

Рекомендация: начать как Vite/React core, сохранив чистые parser/solver modules, а Tauri добавить после первого validated prototype.

### Инструменты калибровки

- отдельный небольшой C# Besiege mod/exporter — самый надёжный способ получить runtime Rigidbody/joint data;
- одноразовый asset extraction script/tool для meshes и prefab defaults;
- JSON schema/version manifest как мост к TypeScript app.

Не стоит делать Python backend частью конечного приложения только ради формул: это усложнит packaging без выигрыша. Python остаётся полезным для research notebooks и regression analysis.

## 14. Производительность

**INFERRED, высокая уверенность:** blade solver имеет сложность O(N blades). Даже большой исследованный `Су-33` содержит 115 лопастей. Одна evaluation — несколько quaternion/vector operations на лопасть. Finite-difference Jacobian требует порядка десятков evaluations, а не миллионов cells как CFD.

Реалистичные ожидания:

- интерактивный пересчёт forces/moments — мгновенный;
- what-if toggle — мгновенный;
- stability derivatives — мгновенные;
- короткая rigid-body time integration — real time или быстрее;
- 3D 875 blocks — нормально при instancing/merged static visuals;
- bottleneck — asset preparation и topology, не aero math.

## 15. Минимальный первый прототип

Не начинать с exact meshes или всех block types.

### Scope prototype 0

1. Parse четырёх перечисленных aircraft BSG.
2. Показать таблицу block counts и parser warnings.
3. Определить IDs 26/55, transforms и `flipped`.
4. Дать пользователю выбрать machine forward/up axes.
5. Отобразить block roots, blade glyphs, forceAxis, senseAxis и CG marker.
6. Реализовать восстановленную `AxialDrag` formula для normal atmosphere.
7. Вводы: speed, AoA, sideslip, pitch/yaw/roll rate.
8. Выводы: per-blade force, total F/M, `ΣF·v`, moment derivatives и damping derivatives.
9. What-if disable для selected blades.
10. Compare двух BSG.

Для CG в prototype 0 допустимы два режима:

- user-supplied CG;
- default-mass point model с явной маркировкой approximate.

### Validation gate

До control-response simulation создать C# probe и подтвердить:

- axes/signs;
- force magnitude на speed sweep;
- velocity cap;
- rotation-at-radius case;
- aggregate moments на одной простой test machine.

Если этот gate проходит, проект имеет твёрдое физическое ядро.

## 16. План разработки по этапам

### Этап 0 — research fixtures и calibration

- сохранить anonymized/minimal BSG fixtures;
- exporter prefab mass/COM/inertia/aero/joint metadata;
- single-blade test rigs;
- version manifest.

### Этап 1 — parser и machine model

- XML 1.3/1.4;
- vanilla/modded refs;
- typed XData;
- transforms;
- diagnostics и golden tests.

### Этап 2 — blade analysis MVP

- IDs 26/55;
- orientation/flipped;
- exact normal-air blade law;
- forces/moments/power;
- derivatives;
- compare/what-if API без polished UI.

### Этап 3 — mass model

- versioned default masses;
- known overrides;
- local COM database;
- point/primitive/runtime-calibrated inertia modes;
- confidence reporting.

### Этап 4 — engineering viewer

- primitives first;
- orbit/select/hide/axes/CG;
- force vectors;
- tables/plots;
- instancing.

### Этап 5 — mechanism graph и controls

- explicit BuildEdge/Surface/endpoints;
- runtime joint graph import;
- hinge subassembly transforms;
- initial control moment/acceleration;
- only then short response curves.

### Этап 6 — exact assets и desktop

- Tauri;
- local game discovery;
- asset extraction/cache;
- optional skins/mod placeholders;
- version compatibility checks.

### Этап 7 — validation and model limits

- compare multiple aircraft;
- residual plots predicted vs measured;
- quantify error bands;
- document unsupported environments/mods.

## 17. Основные технические риски

1. **Game version drift.** IDs, prefabs или coefficients могут измениться. Mitigation: version/hash manifest и fail-closed warnings.
2. **Скрытая mod influence.** Реальные BSG содержат много дополнительных `bmt-*` keys. Mitigation: preserve raw data, report active/required mods, support known handlers only.
3. **Joint graph fidelity.** Главный риск control-surface analysis. Mitigation: runtime exporter вместо геометрической догадки.
4. **Inertia fidelity.** PhysX collider aggregation и scale. Mitigation: runtime-exported tensors плюс approximate modes.
5. **Multibody flex/break.** Не покрывается rigid solver. Mitigation: clearly scoped intact/locked model, empirical correction later.
6. **Coordinate semantics.** `.bsg` не знает, где у самолёта «нос». Mitigation: explicit axis selector and saved per-machine convention.
7. **Asset distribution/licensing.** Не включать extracted proprietary meshes без проверки разрешений; локальный extraction или primitives безопаснее архитектурно.
8. **False precision.** Числа без provenance будут вводить в заблуждение. Mitigation: confidence/source per result and visible model mode.
9. **Long-horizon response overclaim.** Steady turn зависит не только от blades. Mitigation: отдельно показывать local linear response и coupled approximate simulation.

## 18. Неизвестные, которые нужно закрыть до серьёзной реализации

1. Однозначно сопоставить пользовательские forward/backward с `flipped` и выбранным aircraft forward.
2. Проверить recovered blade law инструментированным single-blade test в normal level.
3. Уточнить, когда `GravityController.gravityOverride` меняет branch `AxialDrag`.
4. Экспортировать local COM/inertia для 26/55 и основных structural blocks.
5. Проверить mass и inertia при arbitrary non-uniform scale.
6. Определить точное влияние BEM keys `bmt-Forcemass`, `bmt-RNFmass`, passive/no-collider на анализируемые машины.
7. Выгрузить реальный joint graph `Су-33` и `Проект Ескапе`.
8. Измерить hinge angle/time under load и проверить параметры speed/tension/autoReturn.
9. Провести controlled break test large vs small blade.
10. Решить, поддерживает ли MVP только vanilla blocks или разрешает mod-aware handlers.
11. Определить юридически допустимую стратегию exact meshes.
12. Выбрать и зафиксировать body axes/sign conventions и единицы интерфейса.

## 19. Итоговая оценка сложности

| Часть | Оценка | Причина |
|---|---|---|
| BSG parsing | **Easy** | Открытый XML; 431/431 файлов разобраны; serializer/schema исследованы. |
| 3D reconstruction | **Moderate** | Root layout точен; exact visuals требуют Unity assets, child transforms, procedural blocks, skins/mods. |
| CG calculation | **Moderate** | Формула проста; нужна versioned mass/local-COM database и обработка overrides. |
| Inertia calculation | **Hard** | Нужны full tensors/COM/colliders, scale rules и явное определение locked multibody configuration. |
| Blade identification | **Easy** | Vanilla IDs 26/55 подтверждены enum и файлами. |
| Besiege aerodynamic approximation | **Moderate** | Core vanilla law восстановлен; environment, joints, deformation и validation остаются. |
| Stability analysis | **Moderate** | Производные быстро считаются из force/moment model; качество зависит от CG/inertia и выбранного operating point. |
| Control-response simulation | **Very Hard** | Нет универсального joint graph в BSG; actuator dynamics, flex и PhysX существенно влияют. |
| Real-time visualization | **Easy** | Размеры машин и O(N blades) невелики; Three.js/instancing достаточно. |

## 20. Ответ на главный вопрос

**Да — можно построить инструмент, который по реальному `.bsg` достаточно точно объясняет, почему один самолёт Besiege ведёт себя плавно и стабильно, а другой резко и нестабильно, без запуска полной физики игры.**

Наиболее убедительные объяснения будут относиться к intact rigid configuration и включать:

- реальное расположение и orientation каждой лопасти;
- восстановленный Besiege-specific force law;
- суммарные силы и моменты;
- плечи относительно CG;
- pitch/yaw/roll derivatives;
- rotational damping;
- initial angular acceleration через inertia;
- signed blade power и energy tendency;
- what-if removal.

Точность следует честно ограничить: инструмент объяснит first-order aero/rigid-body cause, но не гарантирует точное воспроизведение joint flex, delayed control motion, breakage и всей траектории PhysX. Для этих частей нужен небольшой runtime calibration/export layer, а не попытка заново реализовать весь Besiege.
