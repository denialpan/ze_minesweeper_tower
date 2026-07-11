import { Instance } from "cs_script/point_script";

const Config = {
    propName: "bonzi_follow_players",
    thinkInterval: 0.01,
    retargetInterval: 5.0,
    moveSpeed: 256,
    stopDistance: 16,
};

const MAX_PLAYER_SLOTS = 64;
const TEAM_CT = 3;

const State = {
    running: false,
    thinkRegistered: false,
    nextRetargetTime: 0,
    targetPosition: null,
};

function scheduleNextThink() {
    Instance.SetNextThink(Instance.GetGameTime() + Config.thinkInterval);
}

function getBonziProp() {
    const prop = Instance.FindEntityByName(Config.propName);

    if (!prop || typeof prop.GetAbsOrigin !== "function" || typeof prop.Teleport !== "function") {
        Instance.Msg(`Missing movable prop '${Config.propName}'`);
        return null;
    }

    return prop;
}

function isLiveCtPawn(pawn) {
    return !!pawn &&
        typeof pawn.IsValid === "function" &&
        pawn.IsValid() &&
        typeof pawn.IsAlive === "function" &&
        pawn.IsAlive() &&
        typeof pawn.GetTeamNumber === "function" &&
        pawn.GetTeamNumber() === TEAM_CT;
}

function getLiveCtPawns() {
    const pawns = [];

    for (let slot = 0; slot < MAX_PLAYER_SLOTS; slot++) {
        const controller = Instance.GetPlayerController(slot);

        if (!controller || typeof controller.IsConnected !== "function" || !controller.IsConnected()) {
            continue;
        }

        if (typeof controller.GetPlayerPawn !== "function") {
            continue;
        }

        const pawn = controller.GetPlayerPawn();

        if (isLiveCtPawn(pawn)) {
            pawns.push(pawn);
        }
    }

    return pawns;
}

function randomInt(maxExclusive) {
    return Math.floor(Math.random() * maxExclusive);
}

function copyVector(vector) {
    return {
        x: vector.x,
        y: vector.y,
        z: vector.z,
    };
}

function chooseRandomCtPosition() {
    const pawns = getLiveCtPawns();

    if (pawns.length === 0) {
        State.targetPosition = null;
        Instance.Msg("bonzi_npc: no live CT players to follow");
        return;
    }

    const pawn = pawns[randomInt(pawns.length)];

    if (!pawn || typeof pawn.GetAbsOrigin !== "function") {
        State.targetPosition = null;
        return;
    }

    State.targetPosition = copyVector(pawn.GetAbsOrigin());
}

function getDistanceSquared(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;

    return dx * dx + dy * dy + dz * dz;
}

function getNextPosition(current, target, maxDistance) {
    const dx = target.x - current.x;
    const dy = target.y - current.y;
    const dz = target.z - current.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance <= maxDistance || distance <= Config.stopDistance) {
        return copyVector(target);
    }

    const scale = maxDistance / distance;

    return {
        x: current.x + dx * scale,
        y: current.y + dy * scale,
        z: current.z + dz * scale,
    };
}

function moveTowardTarget(prop) {
    if (!State.targetPosition) {
        return;
    }

    const current = prop.GetAbsOrigin();
    const stopDistanceSquared = Config.stopDistance * Config.stopDistance;

    if (getDistanceSquared(current, State.targetPosition) <= stopDistanceSquared) {
        return;
    }

    const stepDistance = Config.moveSpeed * Config.thinkInterval;
    const nextPosition = getNextPosition(current, State.targetPosition, stepDistance);

    prop.Teleport({ position: nextPosition });
}

function thinkBonziNpc() {
    if (!State.running) {
        return;
    }

    const prop = getBonziProp();

    if (!prop) {
        State.running = false;
        return;
    }

    const now = Instance.GetGameTime();

    if (now >= State.nextRetargetTime) {
        chooseRandomCtPosition();
        State.nextRetargetTime = now + Config.retargetInterval;
    }

    moveTowardTarget(prop);
    scheduleNextThink();
}

function startBonziNpc() {
    State.running = true;
    State.nextRetargetTime = Instance.GetGameTime();
    State.targetPosition = null;

    if (!State.thinkRegistered) {
        Instance.SetThink(thinkBonziNpc);
        State.thinkRegistered = true;
    }

    scheduleNextThink();
}

function stopBonziNpc() {
    State.running = false;
    State.targetPosition = null;
}

Instance.OnScriptInput("start_bonzi_npc", () => {
    startBonziNpc();
});

Instance.OnScriptInput("stop_bonzi_npc", () => {
    stopBonziNpc();
});
