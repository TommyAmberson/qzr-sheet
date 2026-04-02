local cwd = vim.uv.fs_realpath(vim.fn.getcwd()) or vim.fn.getcwd()
local is_git_repo = vim.uv.fs_stat(cwd .. "/.git") ~= nil
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
          git_reset  = { opts = { allowed_in_yolo_mode = true } },
          git_commit = { opts = { allowed_in_yolo_mode = true } },
        },
      },
    },
    opts = {
      default_servers = { "sequentialthinking", "memory2", "cloudflare-api", "git", "project_commands" },
    },
  },
  interactions = {
    chat = {
      tools = {
        opts = {
          default_tools = { "ask_questions", "files", "get_diagnostics", "web" },
        },
      },
      adapter = {
        -- name = "copilot",
        name = "anthropic",
        -- model = "gpt-5.1-codex",
        -- model = "claude-opus-4.6",
        -- model = "claude-sonnet-4.6",
        -- model = "claude-haiku-4.5",
        model = "claude-haiku-4-5", -- "claude-sonnet-4-5", "claude-opus-4-5", "claude-sonnet-4-6", "claude-opus-4-6", "claude-sonnet-4-0", "claude-3-5-haiku-latest", "claude-opus-4-0", "claude-3-7-sonnet-latest", "claude-opus-4-1",
      },
      opts = {
        system_prompt = function(ctx)
          local prompt = ctx.default_system_prompt
              .. [[Additional context:
The user is working with the zsh shell. Please respond with system specific commands if applicable.
The current working directory is `]] .. cwd .. [[`.
Attempt to minimize the number of tokens. If you need to make multiple steps to complete a request, try to use tools wisely to do as much of the work as possible with the least number of tokens.
]]
          if is_git_repo then
            prompt = prompt .. [[## git MCP server
Try to make the commit style match other commits in the repo. If possible try to find the user's previous commits and match the style. When calling git_commit, always pass the message as a real multi-line string with actual newline characters — never use \n escape sequences, as they will be treated as literal text and fail the commit-msg hook.
]]
          end
          return prompt
        end,
      },
    },
  },
}
