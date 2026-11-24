"""Export a REAL ExecuTorch CPU model for BTU. Requires torch and executorch.
This is a deterministic test graph, NOT a trained image generator.
Usage: python build_cpu_pte.py
"""
from pathlib import Path
import torch
from torch import nn
from executorch.exir import to_edge_transform_and_lower
from executorch.backends.xnnpack.partition.xnnpack_partitioner import XnnpackPartitioner

class BTUDecoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(16, 32, 3, padding=1)
        self.conv2 = nn.Conv2d(32, 3, 3, padding=1)
    def forward(self, x):
        return torch.sigmoid(self.conv2(torch.relu(self.conv1(x))))

def main():
    torch.manual_seed(42)
    model = BTUDecoder().eval()
    example = (torch.randn(1, 16, 64, 64),)
    with torch.no_grad():
        output = model(*example)
    assert tuple(output.shape) == (1, 3, 64, 64)
    exported = torch.export.export(model, example)
    program = to_edge_transform_and_lower(
        exported, partitioner=[XnnpackPartitioner()]
    ).to_executorch()
    dest = Path(__file__).with_name("btu_cinema_inference.pte")
    dest.write_bytes(program.buffer)
    print(f"Exported {dest} ({dest.stat().st_size} bytes), output={tuple(output.shape)}")
    print("WARNING: Random initialized weights; not photorealistic AI generation.")

if __name__ == "__main__":
    main()
