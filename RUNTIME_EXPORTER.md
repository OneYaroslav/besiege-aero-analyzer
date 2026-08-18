# Runtime exporter feasibility

Статический `.bsg` не содержит универсального joint graph. Он хранит transforms и mapper data, а некоторые явные связи присутствуют только у специальных блоков (`Brace`, `Spring`, `Rope`, `BuildEdge`, `BuildSurface`). Этого недостаточно, чтобы доказать, являются ли самолёт и логический куб одним физическим компонентом после загрузки машины.

Минимальный точный exporter должен запускаться внутри Besiege **после** построения машины и завершения mapper/runtime initialization. Для воспроизводимости он также должен записать версию игры и SHA-256 `Assembly-CSharp.dll`.

## Минимальный формат

Для каждого block:

- BSG GUID и block ID/type;
- Unity instance ID и hierarchy path корневого `BlockBehaviour`;
- все принадлежащие ему `Rigidbody`, включая дочерние endpoint bodies, а не только root;
- для каждого Rigidbody: instance ID, hierarchy path, `mass`, `centerOfMass`, `worldCenterOfMass`, `inertiaTensor`, `inertiaTensorRotation`, `isKinematic`, `detectCollisions`, active/enabled state объекта;
- для каждого Collider: type, instance ID, hierarchy path, `enabled`, `gameObject.activeInHierarchy`, `isTrigger`, instance ID `attachedRigidbody`;
- для каждого `Joint`: concrete type, instance ID, owning Rigidbody, `connectedBody` instance ID или `null` для world, `enableCollision`, `breakForce`, `breakTorque`;
- итоговый physical-component ID для каждого Rigidbody и block.

`Rigidbody.centerOfMass` уже является local-space COM Rigidbody. Для единой machine-local системы exporter дополнительно вычисляет:

```csharp
machineLocalCenterOfMass = machineRoot.InverseTransformPoint(rb.worldCenterOfMass);
```

Один block может содержать несколько Rigidbody, поэтому ключом физического графа должен быть Rigidbody instance ID, а не block GUID. Block GUID остаётся provenance/mapping полем.

## Построение component membership

После сбора всех объектов exporter создаёт union-find по Rigidbody:

1. каждый Rigidbody — отдельная вершина;
2. каждый активный Joint с ненулевым `connectedBody` объединяет owning body и connected body;
3. несколько Rigidbody одного block **не объединяются автоматически**: это допустимо только при наличии реального Joint или другого подтверждённого runtime constraint;
4. Joint с `connectedBody == null` означает связь с world и не объединяет два тела;
5. component IDs назначаются после обхода полного набора joints, включая joints на дочерних объектах.

Отдельно полезно выгрузить runtime-объекты Besiege, которые описывают weld/cluster ownership, если они существуют в данной версии. Их нельзя подменять правилом «colliders соприкасаются» — пространственная близость сама по себе не доказывает физическую связь.

## Когда делать снимок

Нужны как минимум два явно подписанных состояния:

- `simulation-start/aero-enabled`: машина загружена, физика запущена, BEM лопасти включены;
- при необходимости `aero-disabled`: после нажатия Space, чтобы подтвердить только отключение сил лопастей.

Для mass/component model достаточно первого состояния. Exporter должен указать frame/time и не смешивать build-mode prefab values с уже изменёнными runtime values.

## Что это закроет

Такой snapshot позволит без эвристики:

- определить, связан ли 28-block логический куб с самолётом;
- учесть дочерние Rigidbody Spring/Rope без double counting;
- получить фактическую runtime массу BuildSurface;
- заменить fallback `block.position` на точные machine-local COM;
- получить точные Rigidbody inertia tensors для следующего этапа.

Текущий PoC намеренно не реализует управление/response по inertia: его `pointMassInertia` — только диагностическая аппроксимация из статически известных масс и COM fallback.
