-- @{cmd_runner}                          Run shell commands initiated by the LLM
-- @{create_file}                         Create a file in the current working directory
-- @{delete_file}                         Delete a file in the current working directory
-- @{fetch_webpage}                       Fetches content from a webpage
-- @{file_search}                         Search for files in the current working directory by glob pattern
-- @{files}                               Tools related to creating, reading and editing files
-- @{full_stack_dev}                      Full Stack Developer - Can run code, edit code and modify files
-- @{get_changed_files}                   Get git diffs of current file changes in a git repository
-- @{grep_search}                         Search for text in the current working directory
-- @{insert_edit_into_file}               Robustly edit existing files with multiple automatic fallback interactions
-- @{list_code_usages}                    Find code symbol context
-- @{mcp}                                 Call tools and resources from MCP servers with:   - `use_mcp_tool`  - `access_mcp_resource`
-- @{memory}                              The memory tool enables LLMs to store and retrieve information across conversations through a memory file directory
-- @{next_edit_suggestion}                Suggest and jump to the next position to edit
-- @{read_file}                           Read a file in the current working directory
-- @{web_search}                          Search the web for information

vim.g.codecompanion_extra_tools = { "files", "git" }
