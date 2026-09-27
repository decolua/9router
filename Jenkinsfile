// Builds the image and pushes it to Harbor as harbor.thisisserver.com/library/9router:<YYYYMMDD>_<build>.
// It does NOT deploy: 9router's manifest lives in Kubernetes-Application as a plain
// Deployment, not in kubernetes-configs' kustomize `images:` that the library edits,
// so the new tag is set there by hand. Turning deployToK8s on would fail with
// "kustomization file not found".
//
// The Claude Code CLI version is the `ARG CLAUDE_CODE_VERSION` default in the
// Dockerfile — the library cannot pass build-args. Change that line to move it.
@Library('JenkinsSharedLibrary@main') _

buildAndDeployApp(
    appName: '9router',
    repoUrl: 'git@github.com:WindowsHyun/9router.git',
    repoBranch: 'master',
    buildType: 'docker-only',   // `next build` runs inside the Dockerfile, so no pre-build step
    dockerfilePath: 'Dockerfile',
    deployToK8s: false,
    kubernetesAgentLabel: 'builder-k3s',
    kubernetesCloud: 'k3s',
)
