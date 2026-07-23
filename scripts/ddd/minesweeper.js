import { Instance, CSInputs } from "cs_script/point_script";

const Config = {
    cellSpacing: 48,
    toolWeaponClass: "weapon_usp_silencer",
    thinkInterval: 0.01,
    traceDistance: 100000,
    failureScriptName: "script_failure",
};

const DefaultBoardOrigin = { x: 128, y: 0, z: 50 };
const MAX_PLAYER_SLOTS = 64;
const DEFAULT_PLAYER_HEALTH = 100;

const ModelNames = {
    tile: "maps/ze_minesweeper_tower/entities/tile_hittable_320.vmdl",
    tile_0: "maps/ze_minesweeper_tower/entities/tile_0_319.vmdl",
    tile_1: "maps/ze_minesweeper_tower/entities/tile_1_311.vmdl",
    tile_2: "maps/ze_minesweeper_tower/entities/tile_2_312.vmdl",
    tile_3: "maps/ze_minesweeper_tower/entities/tile_3_313.vmdl",
    tile_4: "maps/ze_minesweeper_tower/entities/tile_4_314.vmdl",
    tile_5: "maps/ze_minesweeper_tower/entities/tile_5_315.vmdl",
    tile_6: "maps/ze_minesweeper_tower/entities/tile_6_316.vmdl",
    tile_7: "maps/ze_minesweeper_tower/entities/tile_7_317.vmdl",
    tile_8: "maps/ze_minesweeper_tower/entities/tile_8_318.vmdl",
    tile_flag: "maps/ze_minesweeper_tower/entities/tile_flag_324.vmdl",
    tile_mine: "maps/ze_minesweeper_tower/entities/tile_mine_321.vmdl",
    tile_mine_hit: "maps/ze_minesweeper_tower/entities/tile_mine_hit_322.vmdl",
    tile_mine_wrong: "maps/ze_minesweeper_tower/entities/tile_mine_wrong_323.vmdl",
};

const TemplateNames = {
    tile_0: "template_tile_0",
    tile_1: "template_tile_1",
    tile_2: "template_tile_2",
    tile_3: "template_tile_3",
    tile_4: "template_tile_4",
    tile_5: "template_tile_5",
    tile_6: "template_tile_6",
    tile_7: "template_tile_7",
    tile_8: "template_tile_8",
    tile: "template_tile",
    tile_mine: "template_tile_mine",
    tile_mine_wrong: "template_tile_mine_wrong",
    tile_mine_hit: "template_tile_mine_hit",
    tile_flag: "template_tile_flag",
};

const weaponItemList = new WeakMap();

const Game = {
    boards: new Map(),
    entityToCell: new Map(),
    thinkRegistered: false,
};

function createBoardInstance(boardId, origin, width, height, mineCount, secondaryFailureInputName, failureInputName, maxFailuresAllowed = 0, maxFailuresPerPlayerAllowed = -1) {
    return {
        id: boardId,
        board: Board.create(width, height),
        origin: {
            x: origin.x,
            y: origin.y,
            z: origin.z
        },
        width,
        height,
        mineCount,
        started: false,
        over: false,

        // hit mine, but continue game
        secondaryFailureInputName: secondaryFailureInputName || null,

        // hit mine, end game
        failureInputName: failureInputName || null,

        // 0 = no failures allowed
        // positive = this many failures allowed before ending
        // -1 = unlimited failures
        maxFailuresAllowed: maxFailuresAllowed,
        failures: 0,
        maxFailuresPerPlayerAllowed: maxFailuresPerPlayerAllowed,
        playerFailures: new Map(),
    };
}

function getControllerFromPawnLike(entity) {
    if (!entity) {
        return null;
    }

    if (entity.GetPlayerPawn) {
        return entity;
    }

    if (entity.GetPlayerController) {
        return entity.GetPlayerController();
    }

    if (entity.GetOriginalPlayerController) {
        return entity.GetOriginalPlayerController();
    }

    return null;
}

function getPlayerFailureKey(playerEntity) {
    const controller = getControllerFromPawnLike(playerEntity);

    if (controller && controller.GetPlayerSlot) {
        return `slot_${controller.GetPlayerSlot()}`;
    }

    if (controller && controller.GetPlayerName) {
        return `name_${controller.GetPlayerName()}`;
    }

    return null;
}

function getPlayerNameFromEntity(entity) {
    const controller = getControllerFromPawnLike(entity);

    if (controller && controller.GetPlayerName) {
        return controller.GetPlayerName();
    }

    return "unknown player";
}

function registerPlayerMineFailure(boardInstance, actorPawn) {
    if (boardInstance.maxFailuresPerPlayerAllowed === -1) {
        return false;
    }

    const playerKey = getPlayerFailureKey(actorPawn);

    if (!playerKey) {
        Instance.Msg(`${boardInstance.id}: mine hit had no valid player key`);
        return false;
    }

    const previousFailures = boardInstance.playerFailures.get(playerKey) || 0;
    const newFailures = previousFailures + 1;

    boardInstance.playerFailures.set(playerKey, newFailures);

    Instance.Msg(
        `${boardInstance.id}: ${getPlayerNameFromEntity(actorPawn)} personal mine failures ${newFailures}/${boardInstance.maxFailuresPerPlayerAllowed}`
    );

    return newFailures > boardInstance.maxFailuresPerPlayerAllowed;
}

function isBoardActive(boardInstance) {
    return !!boardInstance && boardInstance.started && !boardInstance.over;
}

function getCellOrLog(boardInstance, x, y, actionName) {
    const cell = getCell(boardInstance, x, y);

    if (!cell) {
        Instance.Msg(`invalid ${actionName} cell ${boardInstance.id} (${x}, ${y})`);
        return null;
    }

    return cell;
}

function isLivePawn(entity) {
    return !!entity &&
        entity.IsValid &&
        entity.IsValid() &&
        entity.IsAlive &&
        entity.IsAlive();
}

function killPawnForFailureLimit(boardInstance, actorPawn) {
    if (!isLivePawn(actorPawn)) {
        return;
    }

    Instance.Msg(
        `${boardInstance.id}: killing ${getPlayerNameFromEntity(actorPawn)} for exceeding personal mine failure limit`
    );

    actorPawn.Kill();
}

function triggerBoardInput(boardInstance, inputName, actorPawn) {
    if (!inputName) {
        return;
    }

    Instance.EntFireAtName({
        name: Config.failureScriptName,
        input: "RunScriptInput",
        value: inputName,
        activator: actorPawn,
        caller: actorPawn
    });
}

function scheduleNextThink() {
    Instance.SetNextThink(Instance.GetGameTime() + Config.thinkInterval);
}

function forEachConnectedController(callback) {
    for (let slot = 0; slot < MAX_PLAYER_SLOTS; slot++) {
        const controller = Instance.GetPlayerController(slot);

        if (!controller || !controller.IsConnected()) {
            continue;
        }

        callback(controller, slot);
    }
}

function forEachConnectedLivePawn(callback) {
    forEachConnectedController((controller, slot) => {
        const pawn = controller.GetPlayerPawn();

        if (!isLivePawn(pawn)) {
            return;
        }

        callback(pawn, controller, slot);
    });
}

const Board = {
    create(width, height) {
        const board = [];

        for (let y = 0; y < height; y++) {
            const row = [];

            for (let x = 0; x < width; x++) {
                row.push({
                    x,
                    y,
                    hasMine: false,
                    revealed: false,
                    flagged: false,
                    adjacent: 0,
                    entity: null,
                });
            }

            board.push(row);
        }

        return board;
    },

    inBounds(board, x, y) {
        return y >= 0 && y < board.length && x >= 0 && x < board[0].length;
    },

    placeMines(board, mineCount) {
        const width = board[0].length;
        const height = board.length;

        let placed = 0;

        while (placed < mineCount) {
            const x = Math.floor(Math.random() * width);
            const y = Math.floor(Math.random() * height);

            if (!board[y][x].hasMine) {
                board[y][x].hasMine = true;
                placed++;
            }
        }
    },

    computeAdjacency(board) {
        const width = board[0].length;
        const height = board.length;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (board[y][x].hasMine) {
                    board[y][x].adjacent = -1;
                    continue;
                }

                let count = 0;

                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;

                        const nx = x + dx;
                        const ny = y + dy;

                        if (Board.inBounds(board, nx, ny) && board[ny][nx].hasMine) {
                            count++;
                        }
                    }
                }

                board[y][x].adjacent = count;
            }
        }
    },

    reveal(board, x, y) {
        if (!Board.inBounds(board, x, y)) {
            return [];
        }

        const changed = [];
        const start = board[y][x];

        if (start.revealed || start.flagged) {
            return changed;
        }

        if (start.hasMine) {
            start.revealed = true;
            changed.push(start);
            return changed;
        }

        const queue = [{ x, y }];
        const visited = new Set();

        while (queue.length > 0) {
            const current = queue.shift();
            const key = `${current.x},${current.y}`;

            if (visited.has(key)) {
                continue;
            }

            visited.add(key);

            if (!Board.inBounds(board, current.x, current.y)) {
                continue;
            }

            const cell = board[current.y][current.x];

            if (cell.revealed || cell.flagged || cell.hasMine) {
                continue;
            }

            cell.revealed = true;
            changed.push(cell);

            if (cell.adjacent === 0) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;

                        queue.push({
                            x: current.x + dx,
                            y: current.y + dy,
                        });
                    }
                }
            }
        }

        return changed;
    },

    allSafeCellsRevealed(board) {
        for (let y = 0; y < board.length; y++) {
            for (let x = 0; x < board[y].length; x++) {
                const cell = board[y][x];
                if (!cell.hasMine && !cell.revealed) {
                    return false;
                }
            }
        }

        return true;
    },

    getNeighbors(board, x, y) {
        const neighbors = [];

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;

                const nx = x + dx;
                const ny = y + dy;

                if (Board.inBounds(board, nx, ny)) {
                    neighbors.push({ x: nx, y: ny });
                }
            }
        }

        return neighbors;
    },

    toDebugString(board) {
        const lines = [];
        lines.push("=== BOARD DEBUG ===");
        lines.push("Legend: * = mine, number = adjacent count");

        for (let y = 0; y < board.length; y++) {
            let line = "";

            for (let x = 0; x < board[y].length; x++) {
                const cell = board[y][x];
                line += cell.hasMine ? "* " : (cell.adjacent + " ");
            }

            lines.push(line.trimEnd());
        }

        return lines.join("\n");
    }
};

const View = {
    getTemplate(templateName) {
        const template = Instance.FindEntityByName(templateName);

        if (!template || typeof template.ForceSpawn !== "function") {
            Instance.Msg(`ERROR: template '${templateName}' not found or cannot ForceSpawn`);
            return null;
        }

        return template;
    },

    spawnTemplateAt(templateName, pos, ang, entityName) {
        const template = View.getTemplate(templateName);
        if (!template) {
            return null;
        }

        const spawned = template.ForceSpawn(pos, ang);

        if (!spawned || spawned.length === 0) {
            Instance.Msg(`ERROR: failed to spawn template '${templateName}'`);
            return null;
        }

        const ent = spawned[0];

        if (ent && typeof ent.SetEntityName === "function") {
            ent.SetEntityName(entityName);
        }

        return ent;
    },

    cellVisualKey(cell, revealAllMode) {
        if (revealAllMode === "loss") {
            if (cell.hasMine && cell.revealed) return "tile_mine_hit";
            if (cell.hasMine) return "tile_mine";
            if (cell.flagged && !cell.hasMine) return "tile_mine_wrong";
        }

        if (cell.flagged && !cell.revealed) return "tile_flag";
        if (!cell.revealed) return "tile";
        if (cell.hasMine) return "tile_mine_hit";

        return `tile_${cell.adjacent}`;
    },

    setCellModel(board, x, y, modelName) {
        const ent = board[y][x].entity;

        if (!ent || typeof ent.SetModel !== "function") {
            Instance.Msg(`ERROR: cell (${x}, ${y}) cannot SetModel`);
            return;
        }

        ent.SetModel(modelName);
    },

    updateCell(boardInstance, x, y, revealMode = null) {
        const board = boardInstance.board;
        const cell = board[y][x];

        const visualKey = View.cellVisualKey(cell, revealMode);
        const modelName = ModelNames[visualKey];

        if (!modelName) {
            Instance.Msg(`ERROR: missing model for visual key '${visualKey}'`);
            return;
        }

        const ent = cell.entity;
        if (!ent || typeof ent.SetModel !== "function") {
            Instance.Msg(`ERROR: cell (${x}, ${y}) on ${boardInstance.id} cannot SetModel`);
            return;
        }

        ent.SetModel(modelName);
    },

    updateChangedCells(boardInstance, changedCells) {
        for (const cell of changedCells) {
            View.updateCell(boardInstance, cell.x, cell.y);
        }
    },

    spawnInitialBoard(boardInstance) {
        const board = boardInstance.board;

        for (let y = 0; y < board.length; y++) {
            for (let x = 0; x < board[y].length; x++) {
                const ent = View.spawnTemplateAt(
                    TemplateNames.tile,
                    getCellWorldPosition(boardInstance, x, y),
                    { x: 0, y: 0, z: 0 },
                    `${boardInstance.id}_cell_${x}_${y}`
                );

                board[y][x].entity = ent;

                if (ent) {
                    Game.entityToCell.set(ent, {
                        boardId: boardInstance.id,
                        x,
                        y
                    });
                }
            }
        }
    },

    revealAllAfterLoss(boardInstance) {
        const board = boardInstance.board;

        for (let y = 0; y < board.length; y++) {
            for (let x = 0; x < board[y].length; x++) {
                View.updateCell(boardInstance, x, y, "loss");
            }
        }
    },

    debugEntityGrid(board) {
        Instance.Msg("=== ENTITY DEBUG ===");

        for (let y = 0; y < board.length; y++) {
            let line = "";

            for (let x = 0; x < board[y].length; x++) {
                line += board[y][x].entity ? "E " : ". ";
            }

            Instance.Msg(line.trimEnd());
        }
    }
};

function getCellWorldPosition(boardInstance, x, y) {
    const origin = boardInstance.origin;

    return {
        x: origin.x + x * Config.cellSpacing,
        y: origin.y - y * Config.cellSpacing,
        z: origin.z,
    };
}

function getCell(boardInstance, x, y) {
    if (!boardInstance || !boardInstance.board) {
        return null;
    }

    const board = boardInstance.board;

    if (y < 0 || y >= board.length) {
        return null;
    }

    if (x < 0 || x >= board[y].length) {
        return null;
    }

    return board[y][x];
}

function countFlaggedNeighbors(boardInstance, neighbors) {
    let flaggedCount = 0;

    for (const n of neighbors) {
        const neighbor = getCell(boardInstance, n.x, n.y);

        if (neighbor && neighbor.flagged) {
            flaggedCount++;
        }
    }

    return flaggedCount;
}

function playerIsHoldingTool(playerPawn) {
    if (!playerPawn) {
        return false;
    }

    const active = playerPawn.GetActiveWeapon();
    return !!active &&
        typeof active.GetClassName === "function" &&
        active.GetClassName() === Config.toolWeaponClass;
}

function tagWeaponAsTool(weapon) {
    if (!weapon) {
        return;
    }

    weapon.Glow();
    weaponItemList.set(weapon, 1);
}

function isToolWeapon(weapon) {
    return weaponItemList.has(weapon);
}

function degToRad(deg) {
    return deg * Math.PI / 180;
}

function angleToForward(angles) {
    const pitch = degToRad(angles.pitch);
    const yaw = degToRad(angles.yaw);

    return {
        x: Math.cos(pitch) * Math.cos(yaw),
        y: Math.cos(pitch) * Math.sin(yaw),
        z: -Math.sin(pitch)
    };
}

function traceFromPlayerEyes(playerPawn) {
    const start = playerPawn.GetEyePosition();
    const angles = playerPawn.GetEyeAngles();
    const forward = angleToForward(angles);

    const end = {
        x: start.x + forward.x * Config.traceDistance,
        y: start.y + forward.y * Config.traceDistance,
        z: start.z + forward.z * Config.traceDistance
    };

    Instance.DebugLine({
        start,
        end,
        duration: 2
    });

    return {
        trace: Instance.TraceLine({
            start,
            end,
            ignoreEntity: playerPawn
        }),
        start,
        end
    };
}

function checkWinState(boardInstance) {
    if (Board.allSafeCellsRevealed(boardInstance.board)) {
        endGameWin(boardInstance);
    }
}

function endGameWin(boardInstance) {
    boardInstance.over = true;
    Instance.Msg(`${boardInstance.id}: You win`);
}

function endGameLoss(boardInstance, x, y) {
    boardInstance.over = true;
    View.revealAllAfterLoss(boardInstance);

    Instance.Msg(`${boardInstance.id}: game over after mine hit at (${x}, ${y})`);
}

function handleMineHit(boardInstance, x, y, actorPawn) {
    Instance.Msg(`${boardInstance.id}: BOOM at (${x}, ${y})`);

    const shouldKillActorAfterOutcome =
        registerPlayerMineFailure(boardInstance, actorPawn);

    boardInstance.failures += 1;

    const unlimitedFailures = boardInstance.maxFailuresAllowed === -1;
    const canContinue =
        unlimitedFailures ||
        boardInstance.failures <= boardInstance.maxFailuresAllowed;

    if (canContinue) {
        triggerSecondaryFailureOutcome(boardInstance, actorPawn);

        if (shouldKillActorAfterOutcome) {
            killPawnForFailureLimit(boardInstance, actorPawn);
        }

        checkWinState(boardInstance);
        return;
    }

    triggerFailureOutcome(boardInstance, actorPawn);
    endGameLoss(boardInstance, x, y);

    if (shouldKillActorAfterOutcome) {
        killPawnForFailureLimit(boardInstance, actorPawn);
    }
}

function triggerFailureOutcome(boardInstance, actorPawn) {
    triggerBoardInput(boardInstance, boardInstance.failureInputName, actorPawn);
}

function triggerSecondaryFailureOutcome(boardInstance, actorPawn) {
    triggerBoardInput(boardInstance, boardInstance.secondaryFailureInputName, actorPawn);
}


function revealCellAt(boardInstance, x, y, actorPawn) {
    if (!isBoardActive(boardInstance)) {
        return;
    }

    const cell = getCellOrLog(boardInstance, x, y, "reveal");
    if (!cell) {
        return;
    }

    if (cell.revealed || cell.flagged) {
        return;
    }

    const changed = Board.reveal(boardInstance.board, x, y);

    if (changed.length === 0) {
        return;
    }

    View.updateChangedCells(boardInstance, changed);

    if (cell.hasMine) {
        handleMineHit(boardInstance, x, y, actorPawn);
        return;
    }

    checkWinState(boardInstance);
}

function flagCellAt(boardInstance, x, y) {
    if (!isBoardActive(boardInstance)) {
        return;
    }

    const cell = getCellOrLog(boardInstance, x, y, "flag");
    if (!cell) {
        return;
    }

    if (cell.revealed) {
        return;
    }

    cell.flagged = !cell.flagged;
    View.updateCell(boardInstance, x, y);

    Instance.Msg(
        `${boardInstance.id}: flag toggled at (${x}, ${y}) -> ${cell.flagged}`
    );
}

function chordCellAt(boardInstance, x, y, actorPawn) {
    if (!isBoardActive(boardInstance)) {
        return;
    }

    const cell = getCell(boardInstance, x, y);
    if (!cell) {
        return;
    }

    if (!cell.revealed || cell.hasMine || cell.adjacent <= 0) {
        return;
    }

    const neighbors = Board.getNeighbors(boardInstance.board, x, y);
    const flaggedCount = countFlaggedNeighbors(boardInstance, neighbors);

    if (flaggedCount !== cell.adjacent) {
        Instance.Msg(
            `${boardInstance.id}: chord blocked at (${x}, ${y}) flagged=${flaggedCount} needed=${cell.adjacent}`
        );
        return;
    }

    for (const n of neighbors) {
        const neighbor = getCell(boardInstance, n.x, n.y);

        if (!neighbor || neighbor.revealed || neighbor.flagged) {
            continue;
        }

        handlePrimaryActionAt(boardInstance, n.x, n.y, actorPawn);

        if (boardInstance.over) {
            return;
        }
    }

    Instance.Msg(`${boardInstance.id}: chorded at (${x}, ${y})`);
}

function handlePrimaryActionAt(boardInstance, x, y, actorPawn) {
    if (!isBoardActive(boardInstance)) {
        return;
    }

    const cell = getCellOrLog(boardInstance, x, y, "primary action");
    if (!cell) {
        return;
    }

    if (cell.flagged) {
        return;
    }

    if (cell.revealed) {
        chordCellAt(boardInstance, x, y, actorPawn);
        return;
    }

    revealCellAt(boardInstance, x, y, actorPawn);
}

function clearBoard() {
    const boardIds = [];

    for (const boardId of Game.boards.keys()) {
        boardIds.push(boardId);
    }

    for (const boardId of boardIds) {
        clearBoardInstance(boardId);
    }

    Game.entityToCell.clear();
}

function handleRightClickFlagging() {
    forEachConnectedLivePawn((pawn) => {
        if (!playerIsHoldingTool(pawn)) {
            return;
        }

        if (!pawn.WasInputJustPressed(CSInputs.ATTACK2)) {
            return;
        }

        const target = getTargetedBoardCellFromPawn(pawn);
        if (!target) {
            return;
        }

        flagCellAt(target.boardInstance, target.x, target.y);
    });

    scheduleNextThink();
}

function getTargetedBoardCellFromPawn(playerPawn) {
    const result = traceFromPlayerEyes(playerPawn);
    const trace = result.trace;

    if (!trace || !trace.hitEntity || trace.fraction === undefined) {
        return null;
    }

    const hitInfo = Game.entityToCell.get(trace.hitEntity);
    if (!hitInfo) {
        const name =
            trace.hitEntity && typeof trace.hitEntity.GetEntityName === "function"
                ? trace.hitEntity.GetEntityName()
                : "<unknown>";

        Instance.Msg(`hit non-board entity: ${name}`);
        return null;
    }

    const boardInstance = Game.boards.get(hitInfo.boardId);
    if (!boardInstance) {
        Instance.Msg(`missing board instance '${hitInfo.boardId}'`);
        return null;
    }

    return {
        boardInstance,
        x: hitInfo.x,
        y: hitInfo.y
    };
}

function getAnchorOrigin(anchorName) {
    const anchor = Instance.FindEntityByName(anchorName);

    if (!anchor || typeof anchor.GetAbsOrigin !== "function") {
        Instance.Msg(`Missing board anchor '${anchorName}', using default board origin`);
        return DefaultBoardOrigin;
    }

    const origin = anchor.GetAbsOrigin();

    Instance.Msg(
        `Found board anchor '${anchorName}' at (${origin.x}, ${origin.y}, ${origin.z})`
    );

    return {
        x: origin.x,
        y: origin.y,
        z: origin.z + 64
    };
}

function initializeBoardAt(
    boardId,
    origin,
    width,
    height,
    mineCount,
    secondaryFailureInputName,
    failureInputName,
    maxFailuresAllowed = 0,
    maxFailuresPerPlayerAllowed = -1
) {
    clearBoardInstance(boardId);

    const safeMineCount = Math.max(
        0,
        Math.min(mineCount, width * height - 1)
    );

    const boardInstance = createBoardInstance(
        boardId,
        origin,
        width,
        height,
        safeMineCount,
        secondaryFailureInputName,
        failureInputName,
        maxFailuresAllowed,
        maxFailuresPerPlayerAllowed
    );

    Game.boards.set(boardId, boardInstance);

    Board.placeMines(boardInstance.board, safeMineCount);
    Board.computeAdjacency(boardInstance.board);

    View.spawnInitialBoard(boardInstance);

    boardInstance.started = true;
    boardInstance.over = false;

    Instance.Msg(
        `Initialized ${boardId}: ${width}x${height}, mines=${safeMineCount}, secondaryFailure=${boardInstance.secondaryFailureInputName}, failure=${boardInstance.failureInputName}, maxFailuresAllowed=${boardInstance.maxFailuresAllowed}, maxFailuresPerPlayerAllowed=${boardInstance.maxFailuresPerPlayerAllowed}`
    );

    Instance.Msg(Board.toDebugString(boardInstance.board));
    View.debugEntityGrid(boardInstance.board);
}


function clearBoardInstance(boardId) {
    const boardInstance = Game.boards.get(boardId);
    if (!boardInstance) {
        return;
    }

    const board = boardInstance.board;

    for (let y = 0; y < board.length; y++) {
        for (let x = 0; x < board[y].length; x++) {
            const ent = board[y][x].entity;

            if (ent) {
                Game.entityToCell.delete(ent);

                if (typeof ent.IsValid === "function" && ent.IsValid()) {
                    ent.Remove();
                }
            }

            board[y][x].entity = null;
        }
    }

    Game.boards.delete(boardId);
}

Instance.OnScriptInput("start_board_1", () => {
    initializeBoardAt(
        "board_1",
        getAnchorOrigin("board_1"),
        9,
        9,
        10,
        "secondary_hurt_1_10hp",
        "hurt_1_100hp",
        3,
        0                // max allowed failures
    );

    ensureThinkStarted();
});

Instance.OnScriptInput("start_board_2", () => {
    initializeBoardAt(
        "board_2",
        getAnchorOrigin("board_2"),
        4,
        30,
        10,
        "secondary_hurt_1_10hp",    // mine hit but board continues
        "hurt_1_100hp",             // mine hit ends board
        2                           // max allowed failures
    );

    ensureThinkStarted();
});

Instance.OnScriptInput("stage_0_board_1", () => {
    initializeBoardAt(
        "minesweeper_board_spawn_stage_0",
        getAnchorOrigin("minesweeper_board_spawn_stage_0"),
        9,
        9,
        10,
        "secondary_hurt_1_10hp",    // mine hit but board continues
        "hurt_1_100hp",             // mine hit ends board
        2                           // max allowed failures
    );

    ensureThinkStarted();
});

function ensureThinkStarted() {
    if (!Game.thinkRegistered) {
        Instance.SetThink(handleRightClickFlagging);
        Game.thinkRegistered = true;
    }

    scheduleNextThink();
}

// board primary action entry
Instance.OnGunFire((event) => {
    const weapon = event.weapon;
    if (!isToolWeapon(weapon)) {
        return;
    }

    const owner = weapon.GetOwner();
    if (!owner) {
        return;
    }

    const target = getTargetedBoardCellFromPawn(owner);
    if (!target) {
        return;
    }

    handlePrimaryActionAt(target.boardInstance, target.x, target.y, owner);
});

// round entry point
Instance.OnRoundStart(() => {
    clearBoard();

    const usps = Instance.FindEntitiesByClass("weapon_usp_silencer");
    let numItems = 0;

    for (const weapon of usps) {
        if (weapon.GetEntityName() === "minesweeper_tool") {
            tagWeaponAsTool(weapon);
            numItems += 1;
        }
    }

    Instance.Msg(`tagged ${numItems} world USP entities as tools`);

    // reset health
    let resetCount = 0;

    forEachConnectedLivePawn((pawn) => {
        pawn.SetMaxHealth(DEFAULT_PLAYER_HEALTH);
        pawn.SetHealth(DEFAULT_PLAYER_HEALTH);

        resetCount += 1;
    });

    Instance.Msg(`reset ${resetCount} player(s) to ${DEFAULT_PLAYER_HEALTH} HP`);

});
