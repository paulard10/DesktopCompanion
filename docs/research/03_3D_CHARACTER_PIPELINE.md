# 03 — 3D Character Pipeline: from one illustration to a VRM companion

## 1. Target asset specification

The runtime needs **one VRM 1.0 file** that contains:

| Requirement | Why | VRM feature |
|---|---|---|
| Humanoid skeleton (hips, spine, chest, neck, head, eyes, arms, legs, fingers optional) | Retargeting VRMA clips and procedural head-look | `VRMC_vrm.humanoid` |
| Expressions: `blink`, `blinkLeft/Right`, `happy`, `angry`, `sad`, `relaxed`, `surprised`, visemes `aa ih ou ee oh` | Emotions, lip sync, sleeping (eyes closed) | `VRMC_vrm.expressions` |
| Custom expressions: `sleepy` (half-lidded eyes), `curious`, `thinking` | States the presets don't cover | Custom expressions |
| Eye lookAt (bone or expression applier) | Cursor tracking with the eyes | `VRMC_vrm.lookAt` |
| Spring bones for hair, ears, tail and cloth | Believable secondary motion | `VRMC_springBone` |
| Toon material | Matches illustration style | `VRMC_materials_mtoon` |
| Licence metadata | Commercial distribution | `meta` (avatar permission, commercial usage, modification, redistribution) |
| Budget: ≤ 40k triangles, ≤ 4 × 2048² textures, ≤ 100 bones (INFERRED targets for low GPU cost) | Resource use | — |

Three-vrm loads all of these (`@pixiv/three-vrm`, MIT, VERIFIED). VRMA clips can animate humanoid bones, expressions and lookAt (VRM Animation spec; `@pixiv/three-vrm-animation`, VERIFIED package).

## 2. Paths from one illustration

### Path 1 — VRoid Studio, hand-built from the illustration (**recommended first**)

| Step | Automated? | Notes |
|---|---|---|
| Turn the illustration into a reference sheet (front, side, back, plus close-ups of face and hair) | **Manual or AI-assisted.** An image model can propose side and back views, but you must check them for consistency | A single image has no back or side information. Someone has to invent it |
| Build body, face, hair and outfit in VRoid Studio | **Manual** (sliders, hair guides, texture painting) | 4–20 hours for a competent user, depending on outfit complexity (INFERRED) |
| Rigging, skin weights, spring bones | **Automatic** in VRoid | This is VRoid's main advantage |
| Standard expressions and visemes | **Automatic** (VRoid face presets). Tuning is manual | |
| Custom expressions (sleepy, curious) | Manual (Blender) | Use VRM Add-on for Blender (MIT) |
| Export VRM 1.0 with permissions you control | Automatic | VRoid lets the creator set commercial and redistribution permissions at export ([VRoid conditions of use guidelines](https://developer.vroid.com/en/guidelines/conditions_of_use.html)). **UNKNOWN:** the exact current VRoid Studio terms for bundling default parts in commercial apps. Check the official help centre before shipping |

Strengths: free, the most reliable rig and expressions, results suited to anime illustrations. Weakness: the "VRoid look". Very stylised or non-humanoid designs (mascots, animals) fit poorly.

### Path 2 — commission a 3D artist (VRoid/Blender → VRM)

Fully manual by a professional. It gives the most faithful result, and you can buy **exclusive commercial rights by contract**. Recommended for the shipping character if the illustration is a brand asset. Cost and timeline are UNKNOWN (market rates vary). Get a quote.

### Path 3 — automated image-to-3D, then repair

| Stage | Tools (licence) | Automated? | Typical defects (INFERRED from how these methods work) |
|---|---|---|---|
| Multi-view generation | Image model, or built into the 3D tool | Auto | Inconsistent back views |
| Image → mesh + texture | **TRELLIS** (`microsoft/TRELLIS` code MIT; HF `TRELLIS-image-large` tagged MIT, VERIFIED). **Hunyuan3D-2/2.1** (Tencent community licence **excludes EU, UK and South Korea**, and needs a separate licence above 1M MAU, VERIFIED via licence copies). Hosted Tripo or Meshy (proprietary ToS) | Auto, but needs a CUDA GPU or a cloud service | One fused mesh. No separate eyes, eyelids, teeth or mouth interior. Baked lighting in textures. Messy topology for deformation |
| Auto-rigging | **UniRig** (code MIT, VERIFIED; model-weight licence UNKNOWN). Mixamo (Adobe terms: no redistribution of raw files). AccuRig (proprietary) | Auto | Weight bleeding, broken shoulders, no finger rig |
| Facial blendshapes (blink, visemes, emotions) | **No reliable automated tool found** | **Manual** sculpting in Blender | This is the biggest manual cost of Path 3 |
| VRM conversion (humanoid mapping, MToon, spring bones, metadata) | VRM Add-on for Blender (MIT) | Semi-auto | Spring bone tuning is manual |
| Validation | VRM viewer / three-vrm test page | Auto | — |

Emerging kits: **Charakuru** (single drawing → rigged VRM 1.0, Tripo-sponsored, *source-available under a revenue-gated licence*, early, *"no expressions or eye movement"* per [AlphaSignal coverage](https://alphasignal.ai/news/charakuru-turns-a-single-2d-drawing-into-a-rigged-3d-avatar), secondary source). **CharacterGen** (SIGGRAPH'24, VAST-AI, anime A-pose generation with three-vrm render scripts per the [HF space README](https://huggingface.co/spaces/VAST-AI/CharacterGen/blob/604b72580a799f334d82bcc49c9075dce80694f4/README.md)). Both are UNKNOWN for production quality.

**Verdict on Path 3 (INFERRED):** today it saves time on the *body mesh*, not on what makes a companion believable: eyelids, mouth shapes, expressions and clean deformation around the neck and shoulders for head tracking. Expect 50–80% of the manual repair work of Path 1 anyway, with weaker results for anime styles. **Use it only for exploration, or for non-humanoid mascots that VRoid can't build.**

### Path 4 — in-app "bring your own VRM"

Users load any `.vrm` (VRoid Hub, BOOTH, their own). This is zero work for us. The app must **read and display the VRM licence metadata** and refuse to redistribute it (the AVATAR repo shows a licence-gate UI for VRoid Hub, VERIFIED `docs/vroid-hub.md`).

## 3. Animations: sleep, wake, idle, emotions

| Animation | Recommended source | Automated vs manual |
|---|---|---|
| **Sleep loop** | **Procedural**: `blink`=1 (or `sleepy`), slow breathing (chest/spine pitch ±1.5° at ~0.2 Hz), head droop (neck pitch +12°, roll ±3° drift), optional "Zz" sprite | Code only. **No asset licence needed** |
| **Wake** | Procedural blend: eyes open over 300 ms (overshoot to `surprised` 0.4), head lifts with a critically damped spring, short "stretch" VRMA clip optional | Code, plus an optional hand-made VRMA |
| Idle | Procedural breathing + weight-shift sway + random blinks (2–6 s) + saccades. Optional idle VRMA | Code |
| Happy / curious / thinking / speaking | Expression blends (code) + short VRMA gestures authored in Blender (VRM Add-on exports VRMA) or from an **openly licensed** library | Clips are manual |
| Lip sync | Amplitude → `aa` (MVP), later viseme timing from TTS phonemes | Code |

**Don't bundle third-party clips with unclear terms.** VERIFIED: the pixiv VRMA MotionPack forbids extractable redistribution. Raw Mixamo FBX redistribution is excluded under the commonly quoted Mixamo FAQ ([Adobe community FAQ](https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/m-p/13234775), secondary). Embedding Mixamo motion *inside* an app may be acceptable, but this has to be checked against Adobe's current terms (UNKNOWN). Prefer clips you author yourself or commission.

## 4. Recommended pipeline

1. **MVP (M1):** a placeholder VRM that **you create in VRoid Studio** in about 30–60 minutes from a preset, exported with permissions *you* own. This avoids any third-party sample-model terms. All animation is procedural.
2. **M7:** Path 1 (or Path 2 if the character is a brand asset) from the supplied illustration. Add custom `sleepy`/`curious` expressions in Blender. Commission 4–6 VRMA gestures.
3. **Asset manifest** (copy AVATAR's `docs/assets-manifest.yml` idea): every shipped asset records its rights holder, licence, commercial-use flag and source.
4. **Validation checklist** for any character: humanoid bones mapped; blink and 5 visemes present; head can yaw ±35° without mesh tearing; spring bones settle within 1 s; under 40k triangles; licence meta set.

## 5. Manual vs automated (summary)

| Work item | Automated today | Manual today |
|---|---|---|
| Rig and skin weights | ✅ VRoid / auto-riggers | Fixes for generated meshes |
| Body mesh from image | ⚠ image-to-3D (topology issues) | VRoid modelling / artist |
| Back and side views | ⚠ AI guesses | Art direction |
| Facial expressions and visemes | ✅ VRoid presets only | **Everything else** |
| Spring bones | ✅ VRoid | Tuning |
| Sleep/wake/idle motion | ✅ procedural code | — |
| Gesture clips | ❌ | Blender / mocap / commission |
| Licence clearance | ❌ | **Always manual** |
