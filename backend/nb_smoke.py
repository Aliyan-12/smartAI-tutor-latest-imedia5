import sys
from google import genai
from google.genai import types
from app.core.config import settings

client = genai.Client(api_key=settings.gemini_api_key)
model = "gemini-2.5-flash-image"
prompt = "A clear, labelled educational diagram of a plant cell on a white background, simple flat illustration style."

def try_call(with_cfg):
    kwargs = {"model": model, "contents": prompt}
    if with_cfg:
        kwargs["config"] = types.GenerateContentConfig(response_modalities=["IMAGE"])
    return client.models.generate_content(**kwargs)

for with_cfg in (False, True):
    try:
        resp = try_call(with_cfg)
        parts = resp.candidates[0].content.parts
        img = None
        for p in parts:
            if getattr(p, "inline_data", None) is not None and p.inline_data.data:
                img = p.inline_data.data
                mime = p.inline_data.mime_type
                break
        if img:
            with open("/tmp/nb_test.png", "wb") as f:
                f.write(img)
            print(f"OK with_cfg={with_cfg}: {len(img)} bytes, mime={mime}")
            sys.exit(0)
        else:
            print(f"NO IMAGE with_cfg={with_cfg}; part types: {[type(p).__name__ for p in parts]}; text={getattr(resp,'text',None)!r}")
    except Exception as e:
        print(f"ERROR with_cfg={with_cfg}: {type(e).__name__}: {e}")
sys.exit(1)
