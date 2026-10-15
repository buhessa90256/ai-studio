// ComfyUI API-format workflows for each AI Studio tool (phone version).
// A JavaScript copy of ai-studio-web/workflows.py; keep the two in step.
// Each builder returns [workflow, uploads] where uploads is a list of {name, image} the
// RunPod ComfyUI worker uploads (as base64 data URLs) before running.
"use strict";

const QWEN_UNET = "qwen_image_2.1_int8_convrot.safetensors";
const QWEN_CLIP = "qwen3vl_8b_int8_convrot.safetensors";
const QWEN_VAE = "qwen_image_2.1_vae_bf16.safetensors";
const QWEN_TURBO_LORA = "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors";

const KLEIN_UNET = "flux-2-klein-4b-fp8.safetensors";
const KLEIN_CLIP = "qwen_3_4b.safetensors";
const KLEIN_VAE = "flux2-vae.safetensors";

const WAN_HIGH = "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors";
const WAN_LOW = "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors";
const WAN_LORA_HIGH = "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors";
const WAN_LORA_LOW = "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors";
const WAN_CLIP = "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
const WAN_VAE = "wan_2.1_vae.safetensors";
const WAN_NEGATIVE = "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，"
  + "JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，"
  + "手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走";

const ANIMATE_UNET = "wan2.2_animate_14B_int8_convrot.safetensors";
const ANIMATE_RELIGHT = "wan2.2_animate_14B_relight_lora_bf16.safetensors";
const ANIMATE_LIGHTX2V = "lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors";
const ANIMATE_CLIP_VISION = "clip_vision_h.safetensors";
const ANIMATE_VITPOSE = "vitpose-l-wholebody.onnx";
const ANIMATE_YOLO = "yolov10m.onnx";

const H3_UNET = "minimax_h3_fl2va_pruned_int8_convrot.safetensors";
const H3_CLIP = "qwen3vl_32b_minimax_h3_int8_convrot.safetensors";
const H3_VAE = "minimax_h3_video_vae_fp16.safetensors";
const H3_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors";
const H3_LORA = { 4: "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
  8: "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors" };

const TALK_UNET = "wan2.1_i2v_480p_14B_fp8_scaled.safetensors";
const TALK_PATCH = "wan2.1_infiniteTalk_single_fp16.safetensors";
const TALK_AUDIO_ENCODER = "wav2vec2-chinese-base_fp16.safetensors";
const TALK_LORA = "lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors";

const LTX_CKPT = "ltx-2-19b-distilled-fp8.safetensors";
const LTX_GEMMA = "gemma_3_12B_it_fp4_mixed.safetensors";
const LTX_UPSCALER = "ltx-2-spatial-upscaler-x2-1.0.safetensors";

const AUDIO_CKPT = "stable-audio-open-1.0.safetensors";
const AUDIO_T5 = "t5_base.safetensors";

const MAX31 = 0x7FFFFFFF;

class InputError extends Error {}

function seedOf(p) {
  const s = p.seed;
  return s === undefined || s === null || s === "" || s === -1 || s === "-1"
    ? 1 + Math.floor(Math.random() * 2 ** 48) : parseInt(s, 10);
}
const roundTo = (v, m, lo, hi) => Math.max(lo, Math.min(hi, Math.round(parseInt(v, 10) / m) * m));
const num = (v, d) => (v === undefined || v === null || v === "" ? d : Number(v));

function upload(p, key = "image", ext = ".png", what = "an input image") {
  const data = p[key];
  if (!data) throw new InputError(`Please add ${what}.`);
  const name = `input_${100000000 + Math.floor(Math.random() * 900000000)}${ext}`;
  return [name, [{ name, image: data }]];
}

// ------------------------------------------------------------------ images

function qwen_image(p) {
  const turbo = !!p.turbo;
  const w = roundTo(p.width ?? 1024, 16, 256, 2048), h = roundTo(p.height ?? 1024, 16, 256, 2048);
  const wf = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: QWEN_UNET, weight_dtype: "default" } },
    "3": { class_type: "CLIPLoader", inputs: { clip_name: QWEN_CLIP, type: "qwen_image", device: "default" } },
    "4": { class_type: "VAELoader", inputs: { vae_name: QWEN_VAE } },
    "5": { class_type: "TextEncodeQwenImage21", inputs: {
      clip: ["3", 0], prompt: p.prompt || "", negative_prompt: p.negative || "", resolution: 1024 } },
    "6": { class_type: "EmptyLatentImage", inputs: { width: w, height: h, batch_size: 1 } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["4", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "qwen_image" } },
  };
  let model = ["1", 0];
  if (turbo) {
    wf["10"] = { class_type: "LoraLoaderModelOnly", inputs: { model, lora_name: QWEN_TURBO_LORA, strength_model: 1.0 } };
    model = ["10", 0];
  }
  wf["2"] = { class_type: "QwenImage21Cache", inputs: { model, device: "auto", dtype: "default" } };
  wf["7"] = { class_type: "KSampler", inputs: {
    model: ["2", 0], positive: ["5", 0], negative: ["5", 1], latent_image: ["6", 0],
    seed: seedOf(p), steps: turbo ? 8 : parseInt(p.steps ?? 25, 10), cfg: 1.0,
    sampler_name: "euler", scheduler: "simple", denoise: 1.0 } };
  return [wf, []];
}

function qwen_edit(p) {
  const [name, uploads] = upload(p);
  const turbo = !!p.turbo;
  const wf = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: QWEN_UNET, weight_dtype: "default" } },
    "3": { class_type: "CLIPLoader", inputs: { clip_name: QWEN_CLIP, type: "qwen_image", device: "default" } },
    "4": { class_type: "VAELoader", inputs: { vae_name: QWEN_VAE } },
    "20": { class_type: "LoadImage", inputs: { image: name } },
    "5": { class_type: "TextEncodeQwenImage21", inputs: {
      clip: ["3", 0], vae: ["4", 0], "images.image_1": ["20", 0],
      prompt: p.prompt || "", negative_prompt: "", resolution: 1024 } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["4", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "qwen_edit" } },
  };
  let model = ["1", 0];
  if (turbo) {
    wf["10"] = { class_type: "LoraLoaderModelOnly", inputs: { model, lora_name: QWEN_TURBO_LORA, strength_model: 1.0 } };
    model = ["10", 0];
  }
  wf["2"] = { class_type: "QwenImage21Cache", inputs: { model, device: "auto", dtype: "default" } };
  wf["7"] = { class_type: "KSampler", inputs: {
    model: ["2", 0], positive: ["5", 0], negative: ["5", 1], latent_image: ["5", 2],
    seed: seedOf(p), steps: turbo ? 8 : 25, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0 } };
  return [wf, uploads];
}

function klein_image(p) {
  const w = roundTo(p.width ?? 1024, 16, 256, 2048), h = roundTo(p.height ?? 1024, 16, 256, 2048);
  return [{
    "1": { class_type: "UNETLoader", inputs: { unet_name: KLEIN_UNET, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: KLEIN_CLIP, type: "flux2", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: KLEIN_VAE } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: p.prompt || "" } },
    "5": { class_type: "EmptyFlux2LatentImage", inputs: { width: w, height: h, batch_size: 1 } },
    "6": { class_type: "Flux2Scheduler", inputs: { steps: 4, width: w, height: h } },
    "7": { class_type: "RandomNoise", inputs: { noise_seed: seedOf(p) } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": { class_type: "BasicGuider", inputs: { model: ["1", 0], conditioning: ["4", 0] } },
    "10": { class_type: "SamplerCustomAdvanced", inputs: {
      noise: ["7", 0], guider: ["9", 0], sampler: ["8", 0], sigmas: ["6", 0], latent_image: ["5", 0] } },
    "11": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["3", 0] } },
    "12": { class_type: "SaveImage", inputs: { images: ["11", 0], filename_prefix: "klein" } },
  }, []];
}

function klein_edit(p) {
  const [name, uploads] = upload(p);
  return [{
    "1": { class_type: "UNETLoader", inputs: { unet_name: KLEIN_UNET, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: KLEIN_CLIP, type: "flux2", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: KLEIN_VAE } },
    "20": { class_type: "LoadImage", inputs: { image: name } },
    "21": { class_type: "ImageScaleToTotalPixels", inputs: {
      image: ["20", 0], upscale_method: "nearest-exact", megapixels: 1.0, resolution_steps: 1 } },
    "22": { class_type: "GetImageSize", inputs: { image: ["21", 0] } },
    "23": { class_type: "VAEEncode", inputs: { pixels: ["21", 0], vae: ["3", 0] } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: p.prompt || "" } },
    "24": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    "25": { class_type: "ReferenceLatent", inputs: { conditioning: ["4", 0], latent: ["23", 0] } },
    "26": { class_type: "ReferenceLatent", inputs: { conditioning: ["24", 0], latent: ["23", 0] } },
    "5": { class_type: "EmptyFlux2LatentImage", inputs: { width: ["22", 0], height: ["22", 1], batch_size: 1 } },
    "6": { class_type: "Flux2Scheduler", inputs: { steps: 4, width: ["22", 0], height: ["22", 1] } },
    "7": { class_type: "RandomNoise", inputs: { noise_seed: seedOf(p) } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "9": { class_type: "CFGGuider", inputs: { model: ["1", 0], positive: ["25", 0], negative: ["26", 0], cfg: 1.0 } },
    "10": { class_type: "SamplerCustomAdvanced", inputs: {
      noise: ["7", 0], guider: ["9", 0], sampler: ["8", 0], sigmas: ["6", 0], latent_image: ["5", 0] } },
    "11": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["3", 0] } },
    "12": { class_type: "SaveImage", inputs: { images: ["11", 0], filename_prefix: "klein_edit" } },
  }, uploads];
}

// ------------------------------------------------------------------ video

function wan_i2v(p) {
  const [name, uploads] = upload(p);
  const w = roundTo(p.width ?? 832, 16, 256, 1280), h = roundTo(p.height ?? 480, 16, 256, 1280);
  const seconds = Math.max(1, Math.min(10, num(p.seconds, 5)));
  const length = Math.floor(seconds * 16 + 1);
  return [{
    "1": { class_type: "UNETLoader", inputs: { unet_name: WAN_HIGH, weight_dtype: "default" } },
    "2": { class_type: "UNETLoader", inputs: { unet_name: WAN_LOW, weight_dtype: "default" } },
    "3": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: WAN_LORA_HIGH, strength_model: 1.0 } },
    "4": { class_type: "LoraLoaderModelOnly", inputs: { model: ["2", 0], lora_name: WAN_LORA_LOW, strength_model: 1.0 } },
    "5": { class_type: "ModelSamplingSD3", inputs: { model: ["3", 0], shift: 5.0 } },
    "6": { class_type: "ModelSamplingSD3", inputs: { model: ["4", 0], shift: 5.0 } },
    "7": { class_type: "CLIPLoader", inputs: { clip_name: WAN_CLIP, type: "wan", device: "default" } },
    "8": { class_type: "VAELoader", inputs: { vae_name: WAN_VAE } },
    "9": { class_type: "CLIPTextEncode", inputs: { clip: ["7", 0], text: p.prompt || "" } },
    "10": { class_type: "CLIPTextEncode", inputs: { clip: ["7", 0], text: WAN_NEGATIVE } },
    "11": { class_type: "LoadImage", inputs: { image: name } },
    "12": { class_type: "WanImageToVideo", inputs: {
      positive: ["9", 0], negative: ["10", 0], vae: ["8", 0], start_image: ["11", 0],
      width: w, height: h, length, batch_size: 1 } },
    "13": { class_type: "KSamplerAdvanced", inputs: {
      model: ["5", 0], positive: ["12", 0], negative: ["12", 1], latent_image: ["12", 2],
      add_noise: "enable", noise_seed: seedOf(p), steps: 4, cfg: 1.0,
      sampler_name: "euler", scheduler: "simple", start_at_step: 0, end_at_step: 2,
      return_with_leftover_noise: "enable" } },
    "14": { class_type: "KSamplerAdvanced", inputs: {
      model: ["6", 0], positive: ["12", 0], negative: ["12", 1], latent_image: ["13", 0],
      add_noise: "disable", noise_seed: 0, steps: 4, cfg: 1.0,
      sampler_name: "euler", scheduler: "simple", start_at_step: 2, end_at_step: 10000,
      return_with_leftover_noise: "disable" } },
    "15": { class_type: "VAEDecode", inputs: { samples: ["14", 0], vae: ["8", 0] } },
    "16": { class_type: "CreateVideo", inputs: { images: ["15", 0], fps: 16.0 } },
    "17": { class_type: "SaveVideo", inputs: { video: ["16", 0], filename_prefix: "video/wan_i2v", format: "auto", codec: "auto" } },
  }, uploads];
}

function wan_animate(p) {
  const [ref, up1] = upload(p, "image", ".png", "a character image");
  const [vid, up2] = upload(p, "video", p.video_ext || ".webm", "a movement video");
  const w = roundTo(p.width ?? 832, 16, 256, 1280), h = roundTo(p.height ?? 480, 16, 256, 1280);
  const seconds = Math.max(1, Math.min(7.5, num(p.seconds, 4.8)));
  const length = Math.floor(Math.floor(seconds * 16) / 4) * 4 + 1;
  return [{
    "1": { class_type: "LoadImage", inputs: { image: ref } },
    "2": { class_type: "LoadVideo", inputs: { file: vid } },
    "4": { class_type: "GetVideoComponents", inputs: { video: ["2", 0] } },
    "5": { class_type: "OnnxDetectionModelLoader", inputs: {
      vitpose_model: ANIMATE_VITPOSE, yolo_model: ANIMATE_YOLO, onnx_device: "CUDAExecutionProvider" } },
    "6": { class_type: "PoseAndFaceDetection", inputs: {
      model: ["5", 0], images: ["4", 0], width: w, height: h, retarget_image: ["1", 0] } },
    "7": { class_type: "DrawViTPose", inputs: {
      pose_data: ["6", 0], width: w, height: h, retarget_padding: 16,
      body_stick_width: -1, hand_stick_width: -1, draw_head: true } },
    "8": { class_type: "UNETLoader", inputs: { unet_name: ANIMATE_UNET, weight_dtype: "default" } },
    "9": { class_type: "LoraLoaderModelOnly", inputs: { model: ["8", 0], lora_name: ANIMATE_RELIGHT, strength_model: 1.0 } },
    "10": { class_type: "LoraLoaderModelOnly", inputs: { model: ["9", 0], lora_name: ANIMATE_LIGHTX2V, strength_model: 1.2 } },
    "11": { class_type: "CLIPLoader", inputs: { clip_name: WAN_CLIP, type: "wan", device: "default" } },
    "12": { class_type: "CLIPTextEncode", inputs: { clip: ["11", 0], text: p.prompt || "a person moving" } },
    "13": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["12", 0] } },
    "14": { class_type: "VAELoader", inputs: { vae_name: WAN_VAE } },
    "15": { class_type: "CLIPVisionLoader", inputs: { clip_name: ANIMATE_CLIP_VISION } },
    "16": { class_type: "CLIPVisionEncode", inputs: { clip_vision: ["15", 0], image: ["1", 0], crop: "none" } },
    "17": { class_type: "WanAnimateToVideo", inputs: {
      positive: ["12", 0], negative: ["13", 0], vae: ["14", 0], width: w, height: h,
      length, batch_size: 1, clip_vision_output: ["16", 0], reference_image: ["1", 0],
      face_video: ["6", 1], pose_video: ["7", 0], continue_motion_max_frames: 5, video_frame_offset: 0 } },
    "18": { class_type: "KSampler", inputs: {
      model: ["10", 0], positive: ["17", 0], negative: ["17", 1], latent_image: ["17", 2],
      seed: seedOf(p), steps: 4, cfg: 1.0, sampler_name: "lcm", scheduler: "simple", denoise: 1.0 } },
    "19": { class_type: "TrimVideoLatent", inputs: { samples: ["18", 0], trim_amount: ["17", 3] } },
    "20": { class_type: "VAEDecode", inputs: { samples: ["19", 0], vae: ["14", 0] } },
    "21": { class_type: "CreateVideo", inputs: { images: ["20", 0], fps: 16.0 } },
    "22": { class_type: "SaveVideo", inputs: { video: ["21", 0], filename_prefix: "video/wan_animate", format: "auto", codec: "auto" } },
  }, up1.concat(up2)];
}

function ltx2_t2v(p) {
  const w = roundTo(p.width ?? 1280, 64, 384, 1920), h = roundTo(p.height ?? 704, 64, 256, 1088);
  const seconds = Math.max(2, Math.min(10, num(p.seconds, 5)));
  const frames = Math.round(seconds * 24 / 8) * 8 + 1;  // LTX wants 8k+1 frames
  const seed = seedOf(p);
  return [{
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: LTX_CKPT } },
    "2": { class_type: "LTXVAudioVAELoader", inputs: { ckpt_name: LTX_CKPT } },
    "3": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: LTX_GEMMA, ckpt_name: LTX_CKPT, device: "default" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["3", 0], text: p.prompt || "" } },
    "5": { class_type: "LTXVConditioning", inputs: { positive: ["4", 0], negative: ["4", 0], frame_rate: 24.0 } },
    "6": { class_type: "EmptyLTXVLatentVideo", inputs: { width: Math.floor(w / 2), height: Math.floor(h / 2), length: frames, batch_size: 1 } },
    "7": { class_type: "LTXVEmptyLatentAudio", inputs: { audio_vae: ["2", 0], frames_number: frames, frame_rate: 24, batch_size: 1 } },
    "8": { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["6", 0], audio_latent: ["7", 0] } },
    "9": { class_type: "CFGGuider", inputs: { model: ["1", 0], positive: ["5", 0], negative: ["5", 1], cfg: 1.0 } },
    "10": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler_ancestral" } },
    "11": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "12": { class_type: "ManualSigmas", inputs: { sigmas: "1., 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0" } },
    "13": { class_type: "SamplerCustomAdvanced", inputs: {
      noise: ["11", 0], guider: ["9", 0], sampler: ["10", 0], sigmas: ["12", 0], latent_image: ["8", 0] } },
    "14": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["13", 1] } },
    "15": { class_type: "LatentUpscaleModelLoader", inputs: { model_name: LTX_UPSCALER } },
    "16": { class_type: "LTXVLatentUpsampler", inputs: { samples: ["14", 0], upscale_model: ["15", 0], vae: ["1", 2] } },
    "17": { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["16", 0], audio_latent: ["14", 1] } },
    "18": { class_type: "RandomNoise", inputs: { noise_seed: seed + 1 } },
    "19": { class_type: "ManualSigmas", inputs: { sigmas: "0.909375, 0.725, 0.421875, 0.0" } },
    "20": { class_type: "SamplerCustomAdvanced", inputs: {
      noise: ["18", 0], guider: ["9", 0], sampler: ["10", 0], sigmas: ["19", 0], latent_image: ["17", 0] } },
    "21": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["20", 1] } },
    "22": { class_type: "VAEDecodeTiled", inputs: {
      samples: ["21", 0], vae: ["1", 2], tile_size: 512, overlap: 64, temporal_size: 4096, temporal_overlap: 8 } },
    "23": { class_type: "LTXVAudioVAEDecode", inputs: { samples: ["21", 1], audio_vae: ["2", 0] } },
    "24": { class_type: "CreateVideo", inputs: { images: ["22", 0], audio: ["23", 0], fps: 24.0 } },
    "25": { class_type: "SaveVideo", inputs: { video: ["24", 0], filename_prefix: "video/ltx2", format: "auto", codec: "auto" } },
  }, []];
}

function minimax_h3(p) {
  const w = roundTo(p.width ?? 1344, 32, 256, 1920), h = roundTo(p.height ?? 768, 32, 256, 1920);
  const seconds = Math.max(2, Math.min(15, num(p.seconds, 5)));
  const n = Math.max(5, Math.round(seconds * 24));
  const length = n + ((5 - n % 17) % 17 + 17) % 17;  // H3 wants 17k+5 frames (Python-style modulo)
  const steps = p.quality === "high" ? 8 : 4;
  const wf = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: H3_UNET, weight_dtype: "default" } },
    "2": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: H3_LORA[steps], strength_model: 1.0 } },
    "3": { class_type: "CLIPLoader", inputs: { clip_name: H3_CLIP, type: "minimax", device: "default" } },
    "4": { class_type: "VAELoader", inputs: { vae_name: H3_VAE } },
    "5": { class_type: "VAELoader", inputs: { vae_name: H3_AUDIO_VAE } },
    "7": { class_type: "MiniMaxH3ImageToVideo", inputs: {
      clip: ["3", 0], vae: ["4", 0], prompt: p.prompt || "", width: w, height: h, length } },
    "8": { class_type: "RandomNoise", inputs: { noise_seed: seedOf(p) } },
    "9": { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    "10": { class_type: "BasicScheduler", inputs: { model: ["2", 0], scheduler: "simple", steps, denoise: 1.0 } },
    "11": { class_type: "BasicGuider", inputs: { model: ["2", 0], conditioning: ["7", 0] } },
    "12": { class_type: "SamplerCustomAdvanced", inputs: {
      noise: ["8", 0], guider: ["11", 0], sampler: ["9", 0], sigmas: ["10", 0], latent_image: ["7", 1] } },
    "13": { class_type: "VAEDecode", inputs: { samples: ["12", 0], vae: ["4", 0] } },
    "14": { class_type: "VAEDecodeAudio", inputs: { samples: ["12", 0], vae: ["5", 0] } },
    "15": { class_type: "CreateVideo", inputs: { images: ["13", 0], audio: ["14", 0], fps: 24.0 } },
    "16": { class_type: "SaveVideo", inputs: { video: ["15", 0], filename_prefix: "video/minimax_h3", format: "auto", codec: "auto" } },
  };
  let uploads = [];
  if (p.image) {
    let name;
    [name, uploads] = upload(p);
    wf["6"] = { class_type: "LoadImage", inputs: { image: name } };
    wf["7"].inputs.first_frame = ["6", 0];
  }
  if (p.last_image) {  // end on this frame (same as the first one = seamless loop)
    const [name, more] = upload(p, "last_image", ".png", "a last frame");
    uploads = uploads.concat(more);
    wf["6b"] = { class_type: "LoadImage", inputs: { image: name } };
    wf["7"].inputs.last_frame = ["6b", 0];
  }
  return [wf, uploads];
}

function talking_avatar(p) {
  const [img, up1] = upload(p, "image", ".png", "a photo of the person");
  const [aud, up2] = upload(p, "audio", p.audio_ext || ".wav", "the speech audio");
  const w = roundTo(p.width ?? 832, 16, 256, 1280), h = roundTo(p.height ?? 480, 16, 256, 1280);
  const seconds = Math.max(1, Math.min(20, num(p.audio_seconds, 5) || 5));
  const frames = Math.ceil(seconds * 25) + 1;
  const chunks = 1 + Math.max(0, Math.ceil((frames - 81) / 72));
  const seed = seedOf(p) % MAX31;
  const wf = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: TALK_UNET, weight_dtype: "default" } },
    "2": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: TALK_LORA, strength_model: 1.0 } },
    "3": { class_type: "CLIPLoader", inputs: { clip_name: WAN_CLIP, type: "wan", device: "default" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["3", 0], text: p.prompt || "A person talking naturally to the camera." } },
    "5": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    "6": { class_type: "VAELoader", inputs: { vae_name: WAN_VAE } },
    "7": { class_type: "ModelPatchLoader", inputs: { name: TALK_PATCH } },
    "8": { class_type: "AudioEncoderLoader", inputs: { audio_encoder_name: TALK_AUDIO_ENCODER } },
    "9": { class_type: "LoadAudio", inputs: { audio: aud } },
    "10": { class_type: "AudioEncoderEncode", inputs: { audio_encoder: ["8", 0], audio: ["9", 0] } },
    "11": { class_type: "LoadImage", inputs: { image: img } },
    "12": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
  };
  let video = null;
  for (let k = 0; k < chunks; k++) {
    const b = 100 + k * 10, id = n => String(b + n);
    const talk = { mode: "single_speaker", model: ["2", 0], model_patch: ["7", 0], positive: ["4", 0], negative: ["5", 0],
      vae: ["6", 0], width: w, height: h, length: 81, start_image: ["11", 0], audio_encoder_output_1: ["10", 0],
      motion_frame_count: 9, audio_scale: 1.0 };
    if (video) talk.previous_frames = video;
    wf[id(0)] = { class_type: "WanInfiniteTalkToVideo", inputs: talk };
    wf[id(1)] = { class_type: "RandomNoise", inputs: { noise_seed: seed + k } };
    wf[id(2)] = { class_type: "BasicScheduler", inputs: { model: [id(0), 0], scheduler: "normal", steps: 6, denoise: 1.0 } };
    wf[id(3)] = { class_type: "CFGGuider", inputs: { model: [id(0), 0], positive: [id(0), 1], negative: [id(0), 2], cfg: 1.0 } };
    wf[id(4)] = { class_type: "SamplerCustomAdvanced", inputs: {
      noise: [id(1), 0], guider: [id(3), 0], sampler: ["12", 0], sigmas: [id(2), 0], latent_image: [id(0), 3] } };
    wf[id(5)] = { class_type: "VAEDecode", inputs: { samples: [id(4), 0], vae: ["6", 0] } };
    if (!video) video = [id(5), 0];
    else {  // drop the 9 frames that repeat the end of the previous section, then append
      wf[id(6)] = { class_type: "ImageFromBatch", inputs: { image: [id(5), 0], batch_index: 9, length: 4096 } };
      wf[id(7)] = { class_type: "ImageBatch", inputs: { image1: video, image2: [id(6), 0] } };
      video = [id(7), 0];
    }
  }
  wf["90"] = { class_type: "ImageFromBatch", inputs: { image: video, batch_index: 0, length: frames } };
  wf["91"] = { class_type: "CreateVideo", inputs: { images: ["90", 0], audio: ["9", 0], fps: 25.0 } };
  wf["92"] = { class_type: "SaveVideo", inputs: { video: ["91", 0], filename_prefix: "video/talking", format: "auto", codec: "auto" } };
  return [wf, up1.concat(up2)];
}

function full_video(p) {
  const [w, h] = { landscape: [1344, 768], portrait: [768, 1344], square: [1024, 1024] }[p.shape] || [1344, 768];
  const seed = seedOf(p);
  const [img] = qwen_image({ ...p, prompt: p.scene || p.prompt || "", width: w, height: h, turbo: true, seed });
  const wf = {};
  for (const [k, node] of Object.entries(img)) {
    const inputs = {};
    for (const [key, val] of Object.entries(node.inputs))
      inputs[key] = Array.isArray(val) && val.length === 2 && typeof val[0] === "string" ? ["i" + val[0], val[1]] : val;
    wf["i" + k] = { class_type: node.class_type, inputs };
  }
  delete wf.i9;  // the still is the first frame of the video
  const [vid] = minimax_h3({ ...p, prompt: p.prompt || "", width: w, height: h, image: null, seed: seed + 1 });
  Object.assign(wf, vid);
  wf["7"].inputs.first_frame = ["i8", 0];
  let uploads = [];
  if ((p.voice_text || "").trim()) {
    let ref;
    [ref, uploads] = upload(p, "voice_audio", p.voice_ext || ".wav", "a reference voice");
    wf["30"] = { class_type: "LoadAudio", inputs: { audio: ref } };
    wf["31"] = { class_type: "F5TTSAudioInputs", inputs: {
      sample_audio: ["30", 0], sample_text: p.voice_ref_text || "", speech: p.voice_text,
      seed: seed % MAX31, model: "F5v1", vocoder: "auto", speed: 1.0, model_type: "F5TTS_v1_Base" } };
    wf["32"] = { class_type: "AudioAdjustVolume", inputs: { audio: ["14", 0], volume: -10 } };
    wf["33"] = { class_type: "AudioMerge", inputs: { audio1: ["32", 0], audio2: ["31", 0], merge_method: "add" } };
    wf["15"].inputs.audio = ["33", 0];
  }
  wf["16"].inputs.filename_prefix = "video/full_video";
  return [wf, uploads];
}

// ------------------------------------------------------------------ audio

function stable_audio(p) {
  const seconds = Math.max(1, Math.min(47, Math.round(num(p.seconds, 10))));
  return [{
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: AUDIO_CKPT } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: AUDIO_T5, type: "stable_audio", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: p.prompt || "" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: p.negative || "" } },
    "5": { class_type: "EmptyLatentAudio", inputs: { seconds: seconds, batch_size: 1 } },
    "6": { class_type: "KSampler", inputs: {
      model: ["1", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0],
      seed: seedOf(p), steps: 50, cfg: 4.98, sampler_name: "dpmpp_3m_sde_gpu", scheduler: "exponential", denoise: 1.0 } },
    "7": { class_type: "VAEDecodeAudio", inputs: { samples: ["6", 0], vae: ["1", 2] } },
    "8": { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: seconds, color: 0 } },
    "9": { class_type: "CreateVideo", inputs: { images: ["8", 0], audio: ["7", 0], fps: 1.0 } },
    "10": { class_type: "SaveVideo", inputs: { video: ["9", 0], filename_prefix: "audio/sfx", format: "auto", codec: "auto" } },
  }, []];
}

function f5_voice(p) {
  const [name, uploads] = upload(p, "voice_audio", p.voice_ext || ".wav", "a reference voice recording");
  return [{
    "1": { class_type: "LoadAudio", inputs: { audio: name } },
    "2": { class_type: "F5TTSAudioInputs", inputs: {
      sample_audio: ["1", 0], sample_text: p.voice_text || "", speech: p.prompt || "",
      seed: seedOf(p) % MAX31, model: "F5v1", vocoder: "auto", speed: num(p.speed, 1.0),
      model_type: "F5TTS_v1_Base" } },
    "3": { class_type: "SaveAudio", inputs: { audio: ["2", 0], filename_prefix: "audio/voice" } },
  }, uploads];
}

// ------------------------------------------------------------------ upscale

function seedvr2Nodes(imagesRef, p) {
  const isVideo = p.kind === "video";
  return [{
    "50": { class_type: "SeedVR2LoadDiTModel", inputs: {
      model: "seedvr2_ema_3b_fp16.safetensors", device: "cuda:0", blocks_to_swap: 0,
      swap_io_components: false, offload_device: "none", cache_model: false, attention_mode: "sdpa" } },
    "51": { class_type: "SeedVR2LoadVAEModel", inputs: {
      model: "ema_vae_fp16.safetensors", device: "cuda:0", encode_tiled: true, encode_tile_size: 1024,
      encode_tile_overlap: 128, decode_tiled: true, decode_tile_size: 1024, decode_tile_overlap: 128,
      tile_debug: "false", offload_device: "none", cache_model: false } },
    "52": { class_type: "SeedVR2VideoUpscaler", inputs: {
      image: imagesRef, dit: ["50", 0], vae: ["51", 0], seed: seedOf(p) % MAX31,
      resolution: parseInt(p.resolution ?? 1080, 10), max_resolution: 0,
      batch_size: isVideo ? 5 : 1, uniform_batch_size: false, temporal_overlap: 0,
      prepend_frames: 0, color_correction: "lab", input_noise_scale: 0.0, latent_noise_scale: 0.0,
      offload_device: "cpu", enable_debug: false } },
  }, ["52", 0]];
}

function seedvr2_upscale(p) {
  let wf, uploads;
  if (p.kind === "video") {
    let name;
    [name, uploads] = upload(p, "media", p.media_ext || ".mp4", "a video");
    wf = { "1": { class_type: "LoadVideo", inputs: { file: name } },
           "2": { class_type: "GetVideoComponents", inputs: { video: ["1", 0] } } };
    const [nodes, up] = seedvr2Nodes(["2", 0], p);
    Object.assign(wf, nodes);
    wf["60"] = { class_type: "CreateVideo", inputs: { images: up, audio: ["2", 1], fps: ["2", 2] } };
    wf["61"] = { class_type: "SaveVideo", inputs: { video: ["60", 0], filename_prefix: "video/upscaled", format: "auto", codec: "auto" } };
  } else {
    let name;
    [name, uploads] = upload(p, "media", ".png", "an image");
    wf = { "1": { class_type: "LoadImage", inputs: { image: name } } };
    const [nodes, up] = seedvr2Nodes(["1", 0], p);
    Object.assign(wf, nodes);
    wf["60"] = { class_type: "SaveImage", inputs: { images: up, filename_prefix: "upscaled" } };
  }
  return [wf, uploads];
}

// ------------------------------------------------------------------ 3D

function trellis_3d(p) {
  const [name, uploads] = upload(p);
  const seed = seedOf(p) % MAX31;  // TRELLIS.2 nodes accept seeds up to 2^31-1
  const faces = { low: 30000, standard: 100000, high: 250000 }[p.detail || "standard"] ?? 100000;
  const tex = parseInt(p.texture_size ?? 1024, 10);
  return [{
    "1": { class_type: "LoadImage", inputs: { image: name } },
    "2": { class_type: "Trellis2PreProcessImage", inputs: {
      image: ["1", 0], padding: 10, remove_background: p.remove_background ?? true, max_size: 1024 } },
    "3": { class_type: "Trellis2LoadModel", inputs: {
      modelname: "microsoft/TRELLIS.2-4B", backend: "sdpa", device: "cuda", low_vram: false,
      keep_models_loaded: true, conv_backend: "flex_gemm", sparse_backend: "xformers",
      use_reconviagen: false, pixal3d_multiview: false } },
    "4": { class_type: "Trellis2ImageCondGenerator", inputs: { pipeline: ["3", 0], image: ["2", 0], max_views: 1 } },
    "5": { class_type: "Trellis2SparseGenerator", inputs: {
      pipeline: ["4", 2], image_cond: ["4", 0], seed, sparse_structure_steps: 12,
      sparse_structure_guidance_strength: 7.5, sparse_structure_guidance_rescale: 0.01,
      sparse_structure_rescale_t: 5, sparse_structure_sampler: "heun", sparse_structure_resolution: 32,
      sparse_structure_guidance_interval_start: 0.1, sparse_structure_guidance_interval_end: 1,
      fill_holes: true, hole_iterations: 1, verbose: false, dino_lock: 1, dino_substeps: 8,
      hole_fill_algorithm: "flood_fill", dino_foundation_cap: 1, keep_only_shell: true } },
    "6": { class_type: "Trellis2ShapeGenerator", inputs: {
      pipeline: ["5", 2], image_cond: ["4", 0], coords: ["5", 0], resolution: 512, shape_steps: 12,
      shape_guidance_strength: 7.5, shape_guidance_rescale: 0.01, shape_rescale_t: 3,
      shape_sampler: "heun", shape_guidance_interval_start: 0.1, shape_guidance_interval_end: 1,
      verbose: false, dino_lock: 0, dino_substeps: 9, dino_foundation_cap: 1 } },
    "7": { class_type: "Trellis2DecodeLatents", inputs: {
      pipeline: ["6", 2], shape_slat: ["6", 0], resolution: ["6", 1], use_tiled_decoder: true } },
    "8": { class_type: "Trellis2FillHolesWithCuMesh", inputs: { mesh: ["7", 0], max_permieters: 1 } },
    "9": { class_type: "Trellis2SimplifyMesh", inputs: { mesh: ["8", 0], target_face_num: faces, method: "Cumesh" } },
    "10": { class_type: "Trellis2MeshWithVoxelToTrimesh", inputs: { mesh: ["9", 0], reorient_vertices: "90 degrees" } },
    "11": { class_type: "Trellis2MeshTexturing", inputs: {
      pipeline: ["7", 2], image: ["2", 0], trimesh: ["10", 0], seed, texture_steps: 12,
      texture_guidance_strength: 5, texture_guidance_rescale: 0.05, texture_rescale_t: 3,
      resolution: 1024, texture_size: tex, texture_alpha_mode: "OPAQUE", double_side_material: false,
      texture_guidance_interval_start: 0, texture_guidance_interval_end: 0.99, max_views: 4,
      bake_on_vertices: false, use_custom_normals: false, mesh_cluster_threshold_cone_half_angle_rad: 60,
      sampler: "heun", inpainting: "telea", verbose: false, dino_lock: 0, dino_substeps: 4,
      dino_foundation_cap: 1 } },
    "12": { class_type: "Trellis2ExportMesh", inputs: { trimesh: ["11", 0], filename_prefix: "3d/trellis", file_format: "glb" } },
  }, uploads];
}

function hunyuan_3d(p) {
  const [name, uploads] = upload(p);
  const seed = seedOf(p) % MAX31;
  const faces = { low: 30000, standard: 80000, high: 200000 }[p.detail || "standard"] ?? 80000;
  const tex = parseInt(p.texture_size ?? 1024, 10);
  return [{
    "1": { class_type: "LoadImage", inputs: { image: name } },
    "2": { class_type: "Hy3D21MeshGenerator", inputs: {
      model: "hunyuan3d-dit-v2-1-fp16.ckpt", image: ["1", 0], steps: 25, guidance_scale: 7.5,
      seed, attention_mode: "sdpa" } },
    "3": { class_type: "Hy3D21VAELoader", inputs: { model_name: "Hunyuan3D-vae-v2-1-fp16.ckpt" } },
    "4": { class_type: "Hy3D21VAEDecode", inputs: {
      vae: ["3", 0], latents: ["2", 0], box_v: 1.01, octree_resolution: 256, num_chunks: 64000,
      mc_level: 0.0, mc_algo: "mc", enable_flash_vdm: true, force_offload: false } },
    "5": { class_type: "Hy3D21PostprocessMesh", inputs: {
      trimesh: ["4", 0], remove_floaters: true, remove_degenerate_faces: true, reduce_faces: true,
      max_facenum: faces, smooth_normals: false } },
    "6": { class_type: "Hy3D21MeshUVWrap", inputs: { trimesh: ["5", 0] } },
    "7": { class_type: "Hy3D21CameraConfig", inputs: {
      camera_azimuths: "0, 90, 180, 270, 0, 180", camera_elevations: "0, 0, 0, 0, 90, -90",
      view_weights: "1, 0.5, 1, 0.5, 1, 1", ortho_scale: 1.1 } },
    "8": { class_type: "Hy3DMultiViewsGenerator", inputs: {
      trimesh: ["6", 0], camera_config: ["7", 0], view_size: 768, image: ["1", 0],
      steps: 10, guidance_scale: 3.0, texture_size: tex, unwrap_mesh: false, seed } },
    "9": { class_type: "Hy3DBakeMultiViews", inputs: {
      pipeline: ["8", 0], camera_config: ["7", 0], albedo: ["8", 1], mr: ["8", 2] } },
    "10": { class_type: "Hy3DInPaint", inputs: {
      pipeline: ["9", 0], albedo: ["9", 1], albedo_mask: ["9", 2], mr: ["9", 3], mr_mask: ["9", 4],
      output_mesh_name: `hunyuan_${seed}` } },
    // Hy3DInPaint writes output/<name>.glb and returns its name; PreviewAny makes the handler return it.
    "11": { class_type: "PreviewAny", inputs: { source: ["10", 3] } },
  }, uploads];
}

// ------------------------------------------------------------------ motion

function hy_motion(p) {
  const prompt = (p.prompt || "").trim();
  if (!prompt) throw new InputError("Please describe the movement.");
  return [{
    "1": { class_type: "HYMotionLoadLLM", inputs: {
      model_name: p.llm || "Qwen3-8B", quantization: "none", offload_to_cpu: false } },
    "2": { class_type: "HYMotionEncodeText", inputs: { llm: ["1", 0], text: prompt } },
    "3": { class_type: "HYMotionLoadNetwork", inputs: { model_name: p.network || "HY-Motion-1.0" } },
    "4": { class_type: "HYMotionGenerate", inputs: {
      network: ["3", 0], conditioning: ["2", 0], seed: seedOf(p) % MAX31,
      duration: Math.max(0.5, Math.min(12, num(p.seconds, 4) || 4)), cfg_scale: 5.0, num_samples: 1 } },
    "5": { class_type: "HYMotionPreviewAnimation", inputs: { motion_data: ["4", 0], sample_index: 0 } },
  }, []];
}

// A tiny job that only wakes the GPU worker up (used by "Keep GPU warm").
function wake_up() {
  return [{
    "1": { class_type: "EmptyImage", inputs: { width: 8, height: 8, batch_size: 1, color: 0 } },
    "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "wake" } },
  }, []];
}

// Get a finished job's files again from the copy the worker keeps for 3 days (RunPod forgets after 30 min).
function fetch_result(params) {
  return [{ "1": { class_type: "AIStudioFetchResult", inputs: { job_id: String(params.job_id || "") } } }, []];
}

// klein_*, ltx2_t2v and hunyuan_3d stay above for reference; their models were removed from the volume.
const TOOLS = { qwen_image, qwen_edit, wan_i2v, wan_animate, minimax_h3, talking_avatar, full_video,
  stable_audio, f5_voice, seedvr2_upscale, trellis_3d, hy_motion, wake_up, fetch_result };
