import { Instance, CSDamageFlags, CSDamageTypes } from "cs_script/point_script";

const TEAM_CT = 3;
const MAX_PLAYER_SLOTS = 64;
const FINISHING_DAMAGE_ATTEMPTS = [1, 10, 100, 1000];
const UNKNOWN_PLAYER_NAME = "unknown player";

function forEachConnectedController(callback) {
    for (let slot = 0; slot < MAX_PLAYER_SLOTS; slot++) {
        const controller = Instance.GetPlayerController(slot);

        if (!controller || !controller.IsConnected()) {
            continue;
        }

        callback(controller, slot);
    }
}

function getAliveCTPawns() {
    const ctPawns = [];

    forEachConnectedController((controller) => {
        const pawn = controller.GetPlayerPawn();

        if (!pawn || !pawn.IsValid() || !pawn.IsAlive()) {
            return;
        }

        if (pawn.GetTeamNumber() !== TEAM_CT) {
            return;
        }

        ctPawns.push(pawn);
    });

    return ctPawns;
}

function isValidAlivePawn(pawn) {
    return pawn && pawn.IsValid && pawn.IsValid() && pawn.IsAlive && pawn.IsAlive();
}

function shuffleInPlace(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        const temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }

    return array;
}

function applyAttributedDamage(victimPawn, damage, attackerPawn) {
    if (!isValidAlivePawn(victimPawn)) {
        return;
    }

    const validAttacker = isValidAlivePawn(attackerPawn) ? attackerPawn : undefined;

    victimPawn.TakeDamage({
        damage,
        damageTypes: CSDamageTypes.GENERIC,
        damageFlags: CSDamageFlags.NONE,
        attacker: validAttacker,
        inflictor: validAttacker,
    });
}

function applyMineRawPercentDamage(victimPawn, percentOfMaxHp, attackerPawn) {
    if (!isValidAlivePawn(victimPawn)) {
        return 0;
    }

    applyAttributedDamage(victimPawn, 1, attackerPawn);

    if (!isValidAlivePawn(victimPawn)) {
        return 1;
    }

    const clampedPercent = Math.max(0, Math.min(1, percentOfMaxHp));
    const maxHp = victimPawn.GetMaxHealth();
    const currentHp = victimPawn.GetHealth();

    const rawDamage = Math.max(1, Math.floor(maxHp * clampedPercent));
    const targetHp = currentHp - rawDamage;

    const validAttacker = isValidAlivePawn(attackerPawn) ? attackerPawn : undefined;
    const victimName = getPlayerNameFromEntity(victimPawn);

    if (targetHp > 0) {
        victimPawn.SetHealth(targetHp);

        Instance.Msg(`Mine damaged ${victimName} for ${rawDamage} raw HP.`);

        return rawDamage;
    }

    // Self-lethal: do this last, and kill directly.
    if (validAttacker && victimPawn === validAttacker) {
        victimPawn.Kill();

        Instance.Msg(`Mine killed ${victimName} by self-inflicted damage.`);

        return currentHp;
    }

    // Other-player lethal: try killfeed-attributed damage.
    victimPawn.SetHealth(1);

    let killedByTakeDamage = false;

    for (const finishingDamage of FINISHING_DAMAGE_ATTEMPTS) {
        if (!victimPawn.IsValid() || !victimPawn.IsAlive()) {
            killedByTakeDamage = true;
            break;
        }

        applyAttributedDamage(victimPawn, finishingDamage, validAttacker);

        if (!victimPawn.IsValid() || !victimPawn.IsAlive()) {
            killedByTakeDamage = true;
            break;
        }
    }

    if (!killedByTakeDamage) {
        Instance.Msg(
            `Attributed TakeDamage could not kill ${victimName} after multiple attempts; using Kill() fallback.`
        );

        victimPawn.Kill();
    }

    const attackerName = getPlayerNameFromEntity(validAttacker);

    Instance.Msg(
        `Mine killed ${victimName}. Attacker=${attackerName}.`
    );

    return currentHp;
}

function getMineDamageTargets(playerCount, attackerPawn, onlyAttacker) {
    if (onlyAttacker) {
        return isValidAlivePawn(attackerPawn) ? [attackerPawn] : [];
    }

    const candidates = [];

    if (isValidAlivePawn(attackerPawn)) {
        candidates.push(attackerPawn);
    }

    const ctPawns = getAliveCTPawns();

    for (const pawn of ctPawns) {
        if (!isValidAlivePawn(pawn)) {
            continue;
        }

        // Avoid duplicating the attacker if they are CT.
        if (pawn === attackerPawn) {
            continue;
        }

        candidates.push(pawn);
    }

    shuffleInPlace(candidates);

    const safePlayerCount = Math.max(0, Math.floor(playerCount));
    return candidates.slice(0, Math.min(safePlayerCount, candidates.length));
}

function applyMineFailureDamage(playerCount, percentOfMaxHp, onlyAttacker, inputData) {
    const attackerPawn = inputData ? inputData.activator : undefined;

    if (!isValidAlivePawn(attackerPawn)) {
        Instance.Msg("Mine failure had no valid activator.");
        return;
    }

    const targets = getMineDamageTargets(playerCount, attackerPawn, onlyAttacker);

    if (targets.length === 0) {
        Instance.Msg("Mine failure found no valid damage targets.");
        return;
    }

    const orderedTargets = orderMineDamageTargets(targets, attackerPawn);
    const clampedPercent = Math.max(0, Math.min(1, percentOfMaxHp));

    for (const target of orderedTargets) {
        applyMineRawPercentDamage(target, clampedPercent, attackerPawn);
    }

    Instance.Msg(
        `Mine failure damaged ${orderedTargets.length} target(s) for ${clampedPercent * 100}% max HP.`
    );
}

function orderMineDamageTargets(targets, attackerPawn) {
    const nonAttackers = [];
    let attackerTarget = null;

    for (const target of targets) {
        if (target === attackerPawn) {
            attackerTarget = target;
        } else {
            nonAttackers.push(target);
        }
    }

    // Attacker always last so killfeed attribution remains stable
    // for other victims.
    if (attackerTarget) {
        nonAttackers.push(attackerTarget);
    }

    return nonAttackers;
}

function getPlayerNameFromEntity(entity) {
    if (!entity) {
        return UNKNOWN_PLAYER_NAME;
    }

    // CSPlayerController case
    if (entity.GetPlayerName) {
        return entity.GetPlayerName();
    }

    // CSPlayerPawn case
    if (entity.GetPlayerController) {
        const controller = entity.GetPlayerController();

        if (controller && controller.GetPlayerName) {
            return controller.GetPlayerName();
        }
    }

    // Fallback for pawn-like entities
    if (entity.GetOriginalPlayerController) {
        const controller = entity.GetOriginalPlayerController();

        if (controller && controller.GetPlayerName) {
            return controller.GetPlayerName();
        }
    }

    return UNKNOWN_PLAYER_NAME;
}

Instance.OnScriptInput("secondary_hurt_1_10hp", (inputData) => {
    Instance.Msg("secondary failure trigger");

    applyMineFailureDamage(
        1,          // number of unique random targets
        0.70,       // 70% max HP damage
        false,      // false = random selection including attacker + CTs
        inputData
    );
});

Instance.OnScriptInput("hurt_1_100hp", (inputData) => {
    Instance.Msg("failure trigger");

    applyMineFailureDamage(
        64,          // ignored if onlyAttacker is true
        1.00,       // 100% max HP damage
        false,       // true = damage only the mine hitter
        inputData
    );
});
