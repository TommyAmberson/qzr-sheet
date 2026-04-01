return {
  mcp = {
    servers = {
      ["cloudflare-api"] = {
        cmd = { "npx", "-y", "mcp-remote", "https://mcp.cloudflare.com/mcp" },
        -- Default: write tools require approval and are blocked in YOLO
        tool_defaults = {
          require_approval_before = true,
          allowed_in_yolo_mode = false,
        },
        tool_overrides = {
          -- Read tools: no approval needed
          search = { opts = { require_approval_before = false } },
          -- Write ops (execute)
          -- inherit tool_defaults: require_approval_before = true, allowed_in_yolo_mode = false
        },
      },
      ["git"] = {
        tool_overrides = {
          -- Allow git_add and git_commit in YOLO mode for this repo
          git_add    = { opts = { allowed_in_yolo_mode = true } },
          git_reset    = { opts = { allowed_in_yolo_mode = true } },
          git_commit = { opts = { allowed_in_yolo_mode = true } },
        },
      },
    },
    opts = {
      default_servers = { "sequentialthinking", "memory2", "cloudflare-api", "git" },
    },
  },
  interactions = {
    chat = {
      tools = {
        opts = {
          default_tools = { "ask_questions", "files", "get_diagnostics", "web" },
        },
      },
    },
  },
}
