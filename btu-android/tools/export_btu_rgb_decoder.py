"""Export a 16x64x64 -> RGB 3x64x64 ExecuTorch decoder SMOKE TEST.

Random initialized weights: NOT a trained generative decoder, VQ model, or NPU model.
"""
import argparse
from pathlib import Path
import torch
from torch import nn
from executorch.exir import to_edge

class BTURGBDecoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.feature_expansion = nn.Conv2d(16, 32, 3, padding=1, bias=False)
        self.activation = nn.ReLU()
        self.pixel_refinement = nn.Conv2d(32, 3, 3, padding=1, bias=False)
        self.clamp = nn.Hardtanh(0.0, 1.0)

    def forward(self, latents):
        return self.clamp(self.pixel_refinement(self.activation(self.feature_expansion(latents))))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("btu_cinema_inference.pte"))
    args = parser.parse_args()
    torch.manual_seed(42)
    model = BTURGBDecoder().eval()
    sample = (torch.randn(1, 16, 64, 64),)
    with torch.no_grad():
        output = model(*sample)
    assert tuple(output.shape) == (1, 3, 64, 64)
    exported = torch.export.export(model, sample)
    compiled = to_edge(exported).to_executorch()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(compiled.buffer)
    print(f"Exported {args.output}: {args.output.stat().st_size} bytes")
    print("Input: 65536 floats; output: 12288 floats (CHW RGB)")
    print("WARNING: untrained FP32 decoder; no photorealistic generation or NPU delegation.")

if __name__ == "__main__":
    main()
