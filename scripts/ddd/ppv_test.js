import { Instance } from "cs_script/point_script";

const Config = {
    ppvName: "ppv_test_tint",
};

const State = {
    enabled: false,
};

function getPostProcessingVolume() {
    const ppv = Instance.FindEntityByName(Config.ppvName);

    if (!ppv) {
        Instance.Msg(`Missing post_processing_volume '${Config.ppvName}'`);
        return null;
    }

    return ppv;
}

function setPostProcessingEnabled(enabled) {
    const ppv = getPostProcessingVolume();
    if (!ppv) {
        return;
    }

    Instance.EntFireAtTarget({
        target: ppv,
        input: enabled ? "Enable" : "Disable",
    });

    State.enabled = enabled;
    Instance.Msg(`${Config.ppvName} -> ${enabled ? "Enable" : "Disable"}`);
}

function togglePostProcessing() {
    setPostProcessingEnabled(!State.enabled);
}

Instance.OnScriptInput("toggle_ppv_test", () => {
    togglePostProcessing();
});
