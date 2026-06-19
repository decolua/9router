export default {
  id: "gitlab",
  hidden: true,
  priority: 100,
  display: {
    name: "GitLab Duo",
    icon: "code",
    color: "#FC6D26",
    textIcon: "GL",
    website: "https://gitlab.com",
    notice: {
      signupUrl: "https://gitlab.com",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://gitlab.com/api/v4/chat/completions",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  oauth: {
    defaultBaseUrl: "https://gitlab.com",
    authorizeUrlPath: "/oauth/authorize",
    tokenUrlPath: "/oauth/token",
    userInfoUrlPath: "/api/v4/user",
    scope: "api read_user",
    codeChallengeMethod: "S256",
  },
};
