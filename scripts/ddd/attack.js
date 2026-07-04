import { Instance } from "cs_script/point_script";

const Config = {
    spawnAnchorName: "spawn_attack",
    templateName: "template_attack_1",
    hurtTargetName: "attack_1_hurt",
    totalSpawns: 5,
    visibleDuration: 5.0,
    hiddenDuration: 1.0,
    thinkInterval: 0.01,
    hurtEnableDelay: 4.0,
};

const State = {
    running: false,
    thinkRegistered: false,
    spawnedCount: 0,
    nextActionTime: 0,
    activeEntities: [],
    phase: "idle",
};

function getZeroAngles() {
    return { pitch: 0, yaw: 0, roll: 0 };
}

function getSpawnAnchor() {
    const anchor = Instance.FindEntityByName(Config.spawnAnchorName);

    if (!anchor || typeof anchor.GetAbsOrigin !== "function") {
        Instance.Msg(`Missing attack spawn anchor '${Config.spawnAnchorName}'`);
        return null;
    }

    return anchor;
}

function getTemplate() {
    const template = Instance.FindEntityByName(Config.templateName);

    if (!template || typeof template.ForceSpawn !== "function") {
        Instance.Msg(`Missing attack template '${Config.templateName}'`);
        return null;
    }

    return template;
}

function clearActiveEntities() {
    for (const entity of State.activeEntities) {
        if (!entity || typeof entity.IsValid !== "function" || !entity.IsValid()) {
            continue;
        }

        if (typeof entity.Remove !== "function") {
            continue;
        }

        entity.Remove();
    }

    State.activeEntities = [];
}

function scheduleTriggerHurts(spawned) {
    let triggerCount = 0;

    for (const entity of spawned) {
        if (!entity || typeof entity.GetClassName !== "function") {
            continue;
        }

        if (entity.GetClassName() !== "trigger_hurt") {
            continue;
        }

        if (
            typeof entity.GetEntityName !== "function" ||
            entity.GetEntityName() !== Config.hurtTargetName
        ) {
            continue;
        }

        Instance.EntFireAtTarget({
            target: entity,
            input: "Enable",
            delay: Config.hurtEnableDelay,
        });

        triggerCount += 1;
    }

    if (triggerCount === 0) {
        Instance.Msg(
            `Spawned attack '${Config.templateName}' had no trigger_hurt named '${Config.hurtTargetName}'`
        );
    }
}

function spawnAttack() {
    const anchor = getSpawnAnchor();
    if (!anchor) {
        State.running = false;
        return;
    }

    const template = getTemplate();
    if (!template) {
        State.running = false;
        return;
    }

    const origin = anchor.GetAbsOrigin();
    const angles =
        typeof anchor.GetAbsAngles === "function"
            ? anchor.GetAbsAngles()
            : getZeroAngles();

    const spawned = template.ForceSpawn(origin, angles);

    if (!spawned || spawned.length === 0) {
        Instance.Msg(`Failed to spawn attack template '${Config.templateName}'`);
        return;
    }

    scheduleTriggerHurts(spawned);
    State.activeEntities = spawned;
    State.spawnedCount += 1;

    Instance.Msg(`Spawned attack ${State.spawnedCount}/${Config.totalSpawns}`);
}

function shouldKeepThinking() {
    return State.running;
}

function stopSequence() {
    clearActiveEntities();
    State.running = false;
    State.phase = "idle";
}

function thinkAttackSequence() {
    if (!shouldKeepThinking()) {
        return;
    }

    const now = Instance.GetGameTime();

    if (now < State.nextActionTime) {
        Instance.SetNextThink(now + Config.thinkInterval);
        return;
    }

    if (State.phase === "show") {
        clearActiveEntities();

        if (State.spawnedCount >= Config.totalSpawns) {
            stopSequence();
            Instance.Msg("Attack spawn sequence complete");
            return;
        }

        State.phase = "hide";
        State.nextActionTime = now + Config.hiddenDuration;
        Instance.SetNextThink(now + Config.thinkInterval);
        return;
    }

    spawnAttack();
    State.phase = "show";
    State.nextActionTime = now + Config.visibleDuration;

    Instance.SetNextThink(now + Config.thinkInterval);
}

function ensureThinkRegistered() {
    if (State.thinkRegistered) {
        return;
    }

    Instance.SetThink(thinkAttackSequence);
    State.thinkRegistered = true;
}

function startSequence() {
    ensureThinkRegistered();
    clearActiveEntities();

    State.running = true;
    State.spawnedCount = 0;
    State.phase = "hide";
    State.nextActionTime = Instance.GetGameTime();

    Instance.Msg("Starting attack spawn sequence");
    Instance.SetNextThink(State.nextActionTime);
}

Instance.OnScriptInput("start_attack", () => {
    startSequence();
});
