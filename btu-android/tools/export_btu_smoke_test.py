"""Export a BTU convolution smoke-test model. NOT a generative AI model or INT4 weights."""
import argparse
from pathlib import Path
import torch
from executorch.exir import to_edge

class BTUConvSmokeTest(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = torch.nn.Conv2d(16, 16, 3, padding=1, bias=False)
        self.activation = torch.nn.ReLU()

    def forward(self, latent):
        return self.activation(self.conv(latent))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("btu_cinema_core.pte"))
    args = parser.parse_args()
    torch.manual_seed(42)
    model = BTUConvSmokeTest().eval()
    sample = (torch.randn(1, 16, 64, 64),)
    exported = torch.export.export(model, sample)
    program = to_edge(exported).to_executorch()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(program.buffer)
    print(f"Wrote ExecuTorch smoke-test program: {args.output} ({args.output.stat().st_size} bytes)")
    print("WARNING: Random weights, FP32, CPU smoke test only. Not image/video AI or NPU.")

if __name__ == "__main__":
    main()
