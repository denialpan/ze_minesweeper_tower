import { Instance } from "cs_script/point_script";

const Config = {
    totalSpawns: 100,
    spawnInterval: 0.1,
    thinkInterval: 0.01,
    spawnAnchorName: "spawn_lasers",
    lifetime: 3.0,
    moveLinearInput: "Open",
    spawnSoundName: "sound_test",
    randomHorizontalOffsetMin: -256,
    randomHorizontalOffsetMax: 256,
    randomVerticalOffsetMin: -256,
    randomVerticalOffsetMax: 256,
};

const TemplateNames = [
    "template_laser_horizontal",
    "template_laser_vertical",
];

const State = {
    running: false,
    spawnedCount: 0,
    nextSpawnTime: 0,
    thinkRegistered: false,
    activeLasers: [],
};

function randomInt(maxExclusive) {
    return Math.floor(Math.random() * maxExclusive);
}

function randomFloat(min, max) {
    return min + Math.random() * (max - min);
}

function getRandomTemplateName() {
    return TemplateNames[randomInt(TemplateNames.length)];
}

function getSpawnAnchor() {
    const anchor = Instance.FindEntityByName(Config.spawnAnchorName);

    if (!anchor || typeof anchor.GetAbsOrigin !== "function") {
        Instance.Msg(`Missing laser spawn anchor '${Config.spawnAnchorName}'`);
        return null;
    }

    return anchor;
}

function getTemplateByName(templateName) {
    const template = Instance.FindEntityByName(templateName);

    if (!template || typeof template.ForceSpawn !== "function") {
        Instance.Msg(`Missing laser template '${templateName}'`);
        return null;
    }

    return template;
}

function getZeroAngles() {
    return { pitch: 0, yaw: 0, roll: 0 };
}

function getRandomSpawnOrigin(baseOrigin) {
    return {
        x: baseOrigin.x + randomFloat(
            Config.randomHorizontalOffsetMin,
            Config.randomHorizontalOffsetMax
        ),
        y: baseOrigin.y,
        z: baseOrigin.z + randomFloat(
            Config.randomVerticalOffsetMin,
            Config.randomVerticalOffsetMax
        ),
    };
}

function removeLaserGroup(laserGroup) {
    for (const entity of laserGroup.allEntities) {
        if (!entity || typeof entity.IsValid !== "function" || !entity.IsValid()) {
            continue;
        }

        if (typeof entity.Remove !== "function") {
            continue;
        }

        entity.Remove();
    }
}

function clearActiveLasers() {
    for (const laserGroup of State.activeLasers) {
        removeLaserGroup(laserGroup);
    }

    State.activeLasers = [];
}

function trackSpawnedLaser(spawned, now, templateName) {
    const allEntities = [];

    for (const entity of spawned) {
        if (!entity) {
            continue;
        }

        allEntities.push(entity);
    }

    if (allEntities.length === 0) {
        Instance.Msg(`Spawned laser '${templateName}' had no spawned entities`);
        return;
    }

    State.activeLasers.push({
        templateName,
        expireTime: now + Config.lifetime,
        allEntities,
    });
}

function activateMoveLinears(spawned, templateName) {
    let activatedCount = 0;

    for (const entity of spawned) {
        if (!entity || typeof entity.GetClassName !== "function") {
            continue;
        }

        if (entity.GetClassName() !== "func_movelinear") {
            continue;
        }

        Instance.EntFireAtTarget({
            target: entity,
            input: Config.moveLinearInput,
        });

        activatedCount += 1;
    }

    if (activatedCount === 0) {
        Instance.Msg(`Spawned laser '${templateName}' had no func_movelinear entities`);
    }
}

function playSpawnSound() {
    Instance.EntFireAtName({
        name: Config.spawnSoundName,
        input: "PlaySound",
    });
}

function spawnLaser(now) {
    const anchor = getSpawnAnchor();

    if (!anchor) {
        State.running = false;
        return;
    }

    const templateName = getRandomTemplateName();
    const template = getTemplateByName(templateName);

    if (!template) {
        State.running = false;
        return;
    }

    const origin = getRandomSpawnOrigin(anchor.GetAbsOrigin());
    const angles =
        typeof anchor.GetAbsAngles === "function"
            ? anchor.GetAbsAngles()
            : getZeroAngles();

    const spawned = template.ForceSpawn(origin, angles);

    if (!spawned || spawned.length === 0) {
        Instance.Msg(`Failed to spawn laser template '${templateName}'`);
        return;
    }

    activateMoveLinears(spawned, templateName);
    trackSpawnedLaser(spawned, now, templateName);
    playSpawnSound();

    State.spawnedCount += 1;

    Instance.Msg(
        `Spawned laser ${State.spawnedCount}/${Config.totalSpawns} from '${templateName}'`
    );
}

function stopSequence() {
    State.running = false;
}

function cleanupExpiredLasers(now) {
    if (State.activeLasers.length === 0) {
        return;
    }

    for (let i = State.activeLasers.length - 1; i >= 0; i--) {
        const laserGroup = State.activeLasers[i];

        if (now >= laserGroup.expireTime) {
            removeLaserGroup(laserGroup);
            State.activeLasers.splice(i, 1);
        }
    }
}

function shouldKeepThinking() {
    return State.running || State.activeLasers.length > 0;
}

function thinkSpawnSequence() {
    if (!shouldKeepThinking()) {
        return;
    }

    const now = Instance.GetGameTime();
    cleanupExpiredLasers(now);

    if (State.running && State.spawnedCount >= Config.totalSpawns) {
        stopSequence();
        Instance.Msg("Laser spawn sequence complete");
    }

    while (State.running && State.spawnedCount < Config.totalSpawns && now >= State.nextSpawnTime) {
        spawnLaser(now);
        State.nextSpawnTime += Config.spawnInterval;
    }

    if (shouldKeepThinking()) {
        Instance.SetNextThink(now + Config.thinkInterval);
    }
}

function ensureThinkRegistered() {
    if (State.thinkRegistered) {
        return;
    }

    Instance.SetThink(thinkSpawnSequence);
    State.thinkRegistered = true;
}

function startSequence() {
    ensureThinkRegistered();
    clearActiveLasers();

    State.running = true;
    State.spawnedCount = 0;
    State.nextSpawnTime = Instance.GetGameTime();

    Instance.Msg("Starting laser spawn sequence");
    Instance.SetNextThink(State.nextSpawnTime);
}

Instance.OnScriptInput("start_lasers", () => {
    startSequence();
});
