# SceneForge B200 GPU inference (isolated from BTU and NexusRemote)
Source code and an opt-in deployment pipeline for a Cerebrium B200 GPU and Apache-2.0 Qwen-Image-2512 model.
The application is NOT deployed until a Cerebrium service account and project are provided, the Actions workflow is deliberately started by the owner, and model/GPU runtime checks succeed. Deploying a B200 consumes billable compute.
## Verified endpoints and configuration
- SceneForge web app: https://sceneforge-studio.hatchable.site
- Hatchable member-only proxy: GET /api/gpu-health, POST /api/gpu-render with prompt, width, height
- Worker: GET /health, POST /predict, protected with Cerebrium inference JWT
- Set a p-... Cerebrium project ID in Hatchable Configure (cerebrium_project_id) and an **inference JWT** in Hatchable Setup (CEREBRIUM_JWT).
- The app derives https://api.cerebrium.ai/v4/<project-id>/sceneforge-qwen-quality-b200/predict. Alternatively configure cerebrium_endpoint.
## Deploy intentionally
1. Create and activate a Cerebrium project and confirm B200 access, billing, memory and region.
2. In GitHub Actions repository settings set the secret **CEREBRIUM_SERVICE_ACCOUNT_TOKEN** and variable **CEREBRIUM_PROJECT_ID** with p-... format.
3. Merge this review branch if satisfied. The new workflow checks source on PR and supports manually triggered GPU deployment on master. It is not scheduled and never bills GPU on a PR.
4. In Actions run **SceneForge Cerebrium B200 (validate / manual deploy)**, branch master, and check build logs.
5. Check the deployed worker /health with an authorized inference JWT, then use the Hatchable GPU health button.
This deploy token is distinct from the Cerebrium inference JWT. Neither is committed.
## Limitations
The large Qwen model has substantial cold-start and weight-download costs. The Hatchable proxy currently has a 50-second request limit; GPU deployment does NOT guarantee a completed generation. Runtime model loading, image generation, phone playback, and billing are not verified by source tests.
## CPU tests
`python -m pip install fastapi pydantic`
`python -m unittest discover -s tests -v`
`python -m py_compile main.py contract.py`
