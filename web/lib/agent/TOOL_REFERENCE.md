# Window Tools Reference

Comprehensive documentation for all window tools available to the AI agent.

**Location:** `web/lib/agent/window-tools/`

**Architecture:** Each window kind gets a dedicated tool bag that is dynamically injected into the orchestrator based on the currently focused window. This keeps the LLM context tight — only tools relevant to the active window (+ global navigation tools) are exposed in each turn.

---

## Table of Contents

1. [Overview](#overview)
2. [Tool Categories](#tool-categories)
3. [All Tools by Window](#all-tools-by-window)
4. [Quick Reference Table](#quick-reference-table)
5. [Common Patterns](#common-patterns)
6. [Window-Specific Details](#window-specific-details)

---

## Overview

### How Window Tools Work

1. **Context Binding**: Tools are bound to `AgentToolCtx` containing:
   - `snapshot`: Current UI state (windows, viewport, focused window)
   - `emit`: Function to emit AgentEvents for UI updates

2. **Event Flow**:
   ```
   Agent → Tool.execute() → AgentEvents → UI updates → Snapshot mutation
   ```

3. **Naming Convention**: Tools follow `{window}_{action}` pattern (e.g., `chat_scroll_to_top`, `graph_focus_node`)

### 15 Window Tool Files

| File | Window Kind | Tool Count | Purpose |
|------|-------------|------------|---------|
| `ask-user.ts` | `ask_user` | 8 | Modal for user questions with multiple-choice |
| `chat.ts` | `chat` | 8 | Chat transcript navigation and analysis |
| `chats-summary.ts` | `chats_summary` | 12 | Chat signal statistics and filtering |
| `entities.ts` | `entities` | 10 | Entity list browsing and filtering |
| `entity-detail.ts` | `entity_detail` | 11 | Individual entity CRUD operations |
| `graph.ts` | `graph` | 11 | Knowledge graph visualization control |
| `integration-detail.ts` | `integration_detail` | 10 | Single integration management |
| `integrations.ts` | `integrations` | 12 | Integration list and connection |
| `memories.ts` | `memories` | 12 | Memory list and filtering |
| `profile.ts` | `profile` | 9 | User profile CRUD |
| `settings.ts` | `settings` | 8 | App settings and health checks |
| `skills.ts` | `skills` | 12 | Skill catalog and strengthening |
| `wiki.ts` | `wiki` | 13 | Wiki page CRUD and navigation |
| `window-management.ts` | All | 18 | Window positioning and layout |
| `workflows.ts` | `workflows` | 12 | Workflow editor and execution |

**Total: 166 tools across 15 files**

---

## Tool Categories

### Navigation/Discovery (Finding Things)

Tools for searching, filtering, and discovering content across windows.

| Tool | Description | Use When... |
|------|-------------|-------------|
| `chat_search_messages` | Search chat content | User asks "find where we discussed X" |
| `chatsummary_search` | Search across all chats | Looking for specific conversation |
| `entities_search` | Find entities by name/alias | User mentions a person/project by name |
| `graph_search` | Filter graph nodes by label | Narrowing graph to specific topic |
| `integrations_search` | Find integration by name/slug | User wants to connect a tool |
| `memories_search` | Search memory content | Recalling past observations |
| `skills_search` | Find skills by name/description | User asks "can you do X?" |
| `wiki_search` | Search wiki pages | Looking for documentation |
| `workflows_search` | Find workflows by name/desc | User wants to run a workflow |

### Read/Inspect (Viewing Data)

Tools for reading current state without modification.

| Tool | Description | Use When... |
|------|-------------|-------------|
| `chat_read_last_n` | Get recent chat context | Summarizing recent conversation |
| `chatsummary_read_stats` | Get chat counts by source | Reporting activity metrics |
| `entity_detail_read` | Get full entity details | User asks "tell me about X" |
| `graph_read_state` | Get graph viewport state | Debugging graph view |
| `integration_detail_read` | Get integration info | User asks about connected tool |
| `memories_list` | List all memories | Showing what the system remembers |
| `profile_read_all` | Get user profile | Personalizing responses |
| `settings_read_all` | Get app settings | Checking configuration |
| `skills_read_detail` | Get skill steps | Explaining how something works |
| `wiki_read_page` | Read wiki content | Accessing documentation |
| `workflows_read_skill_chain` | Get workflow steps | Explaining a process |
| `winman_read_window_list` | List all open windows | Debugging layout |

### Write/Modify (Changing Data)

Tools for creating, updating, or deleting content.

| Tool | Description | Use When... |
|------|-------------|-------------|
| `entity_detail_set_description` | Update entity description | User corrects entity info |
| `entity_detail_add_alias` | Add nickname/variation | Entity has multiple names |
| `entity_detail_add_tag` | Categorize entity | Organizing entities |
| `profile_set_name` | Update display name | User introduces themselves |
| `profile_add_goal` | Add to goals list | Capturing user objectives |
| `settings_set_ui_mode` | Switch windowed/chat | User requests mode change |
| `wiki_edit_page` | Enter wiki edit mode | User wants to update docs |
| `wiki_save_page` | Commit wiki changes | Saving documentation edits |
| `wiki_new_page` | Create wiki page | Adding new documentation |
| `workflows_save` | Save workflow edits | Creating/modifying workflows |
| `integration_detail_set_purpose` | Document integration use | User explains why they use tool |

### Layout/Arrangement (Window Positioning)

Tools for managing the visual layout of windows.

| Tool | Description | Use When... |
|------|-------------|-------------|
| `winman_move_to_position` | Move to mount point | Positioning window precisely |
| `winman_arrange_preset` | Apply layout template | "Arrange windows for focus" |
| `winman_swap_positions` | Swap two windows | Reordering side-by-side views |
| `winman_pin_window` | Pin to left sideline | Keeping window accessible |
| `winman_bring_to_front` | Focus window | Making window prominent |
| `winman_maximize_window` | Full-screen window | Deep focus on single content |
| `winman_minimize_window` | Picture-in-picture | Keeping window visible but small |
| `winman_cascade_windows` | Stacked diagonal layout | Viewing many windows at once |
| `winman_tile_windows` | Grid arrangement | Equal visibility for all windows |

### Meta (High-Level Operations)

Tools for cross-cutting concerns and system operations.

| Tool | Description | Use When... |
|------|-------------|-------------|
| `integrations_open_connect_manager` | Open OAuth manager | User says "connect to Slack" |
| `integrations_connect_toolkit` | Start OAuth flow | Connecting specific integration |
| `settings_check_health` | Check backend status | Debugging connection issues |
| `winman_read_layout_state` | Get layout overview | Understanding current workspace |
| `chatsummary_jump_to_full_chat` | Navigate to chat | Moving from summary to detail |
| `entity_detail_go_back` | Return to list | Finished viewing entity |
| `skills_open_workflows_using` | See skill usage | Finding where skill is applied |
| `workflows_run` | Execute workflow | Running automated process |

---

## All Tools by Window

### 1. ask-user.ts (8 tools)

Modal for asking the user questions with multiple-choice or free-text responses.

| Tool | Description | When to Use |
|------|-------------|-------------|
| `askuser_set_question` | Set/update question text | Presenting a new question to user |
| `askuser_set_options` | Set multiple-choice options (max 4) | Providing answer choices |
| `askuser_await_response` | Signal waiting state | After presenting question, before answer |
| `askuser_close_modal` | Close without response | Question answered elsewhere or canceled |
| `askuser_read_response` | Check if user responded | Polling for answer during wait |
| `askuser_change_modal_position` | Move to center/bottom/corner | Adjusting modal placement |
| `askuser_set_priority` | Set low/normal/high priority | Indicating urgency level |
| `askuser_add_hint` | Add explanatory text below question | Providing context or examples |

**Params:**
- `askuser_set_question`: `question` (string, 1-500 chars) [REQUIRED]
- `askuser_set_options`: `options` (string[], max 4) [REQUIRED]
- `askuser_change_modal_position`: `position` ("center"|"bottom"|"corner") [REQUIRED]
- `askuser_set_priority`: `priority` ("low"|"normal"|"high") [REQUIRED]
- `askuser_add_hint`: `hint` (string, 1-1000 chars) [REQUIRED]
- `askuser_close_modal`: `reason` (string, optional)

---

### 2. chat.ts (8 tools)

Chat transcript navigation, search, and analysis tools.

| Tool | Description | When to Use |
|------|-------------|-------------|
| `chat_scroll_to_top` | Scroll to oldest messages | Reviewing conversation start |
| `chat_scroll_to_bottom` | Scroll to newest messages | Returning to present |
| `chat_search_messages` | Highlight messages by term | Finding specific discussion |
| `chat_filter_by_role` | Show only user/agent messages | Analyzing one side of conversation |
| `chat_read_last_n` | Get last N message summaries | Capturing recent context |
| `chat_summarize_thread` | Generate conversation summary | Condensing long discussion |
| `chat_jump_to_timestamp` | Navigate to specific time | Finding historical moment |
| `chat_export_transcript` | Save as text/markdown | User requests chat export |

**Params:**
- `chat_search_messages`: `query` (string) [REQUIRED], `case_sensitive` (boolean, optional)
- `chat_filter_by_role`: `role` ("user"|"agent"|"") [REQUIRED]
- `chat_read_last_n`: `n` (number, 1-100, default 10) [REQUIRED]
- `chat_summarize_thread`: `last_n` (number, optional), `focus` ("decisions"|"actions"|"questions"|"full", default "full")
- `chat_jump_to_timestamp`: `timestamp` (number, ms) [REQUIRED], `strategy` ("exact"|"nearest_before"|"nearest_after", default "nearest_after")
- `chat_export_transcript`: `format` ("text"|"markdown", default "markdown"), `filename` (string, optional), `include_timestamps` (boolean, default true)

---

### 3. chats-summary.ts (12 tools)

Aggregated chat statistics across all sources (Slack, Gmail, etc.).

| Tool | Description | When to Use |
|------|-------------|-------------|
| `chatsummary_read_stats` | Get total counts, by source | Reporting activity overview |
| `chatsummary_read_recent` | Paginated recent chats | Browsing recent activity |
| `chatsummary_filter_by_source` | Filter to Slack/Gmail/etc. | Focusing on one platform |
| `chatsummary_filter_by_date_range` | Filter by time period | "Show me yesterday's chats" |
| `chatsummary_sort_by_signal_level` | Sort by low/mid/high signal | Prioritizing important chats |
| `chatsummary_search` | Search chat content/titles | Finding specific conversation |
| `chatsummary_read_entity_mentions` | See who/what is mentioned | Extracting entities from chats |
| `chatsummary_open_source_chat` | Open original in source view | Deep-dive into specific chat |
| `chatsummary_export_summary` | Export as report | Generating summaries |
| `chatsummary_refresh` | Fetch latest from server | Ensuring fresh data |
| `chatsummary_read_by_integration` | Group by integration source | Understanding platform usage |
| `chatsummary_jump_to_full_chat` | Navigate to detailed view | Moving to full chat window |

**Params:**
- `chatsummary_read_recent`: `limit` (number, 1-100, default 20), `offset` (number, default 0)
- `chatsummary_filter_by_source`: `source` ("slack"|"gmail"|"github"|"linear"|"notion"|"perplexity"|"canvas"|"canvas_agent") [REQUIRED], `clear_others` (boolean, optional)
- `chatsummary_filter_by_date_range`: `from` (ISO date string) [REQUIRED], `to` (ISO date string, optional)
- `chatsummary_sort_by_signal_level`: `direction` ("asc"|"desc", default "desc"), `filter_to` ("low"|"mid"|"high", optional)
- `chatsummary_search`: `query` (string) [REQUIRED], `search_in` ("content"|"title"|"both", default "both"), `case_sensitive` (boolean, default false)
- `chatsummary_read_entity_mentions`: `entity_type` (string, optional), `min_mentions` (number, default 1)
- `chatsummary_open_source_chat`: `chat_id` (string) [REQUIRED], `source_type` (SOURCE_TYPE) [REQUIRED]
- `chatsummary_export_summary`: `format` ("markdown"|"json"|"csv", default "markdown"), `include_metadata` (boolean, default true), `filename` (string, optional)
- `chatsummary_jump_to_full_chat`: `chat_id` (string, optional), `focus_query` (string, optional)

---

### 4. entities.ts (10 tools)

Entity list browsing with type tabs and filtering.

| Tool | Description | When to Use |
|------|-------------|-------------|
| `entities_list_by_type` | Show entities of specific type | "Show me all projects" |
| `entities_switch_type_tab` | Change active type tab | Switching between people/docs/etc |
| `entities_search` | Find by name/alias | User mentions entity by name |
| `entities_sort_by_mentions` | Sort by mention count | Finding most referenced |
| `entities_sort_alphabetically` | A-Z or Z-A sort | Scanning ordered list |
| `entities_open_detail` | Open entity detail window | Deep-dive into specific entity |
| `entities_quick_add` | Open add-entity form | Creating new entity |
| `entities_read_types` | List types with counts | Understanding entity landscape |
| `entities_filter_by_tag` | Filter to tagged entities | Finding categorized items |
| `entities_refresh_list` | Reload from server | Ensuring fresh entity list |

**Params:**
- `entities_list_by_type`: `entity_type` (string) [REQUIRED]
- `entities_switch_type_tab`: `entity_type` (string) [REQUIRED]
- `entities_search`: `query` (string) [REQUIRED]
- `entities_sort_by_mentions`: `ascending` (boolean, default false)
- `entities_sort_alphabetically`: `ascending` (boolean, default true)
- `entities_open_detail`: `entity_id` (string) [REQUIRED], `name` (string, optional), `entity_type` (string, optional)
- `entities_quick_add`: `default_name` (string, optional), `default_type` (string, optional)
- `entities_filter_by_tag`: `tag` (string) [REQUIRED]

---

### 5. entity-detail.ts (11 tools)

Individual entity CRUD operations (name, type, description, aliases, tags).

| Tool | Description | When to Use |
|------|-------------|-------------|
| `entity_detail_read` | Get full entity details | Loading entity information |
| `entity_detail_set_description` | Update description | Correcting entity info |
| `entity_detail_add_alias` | Add alternative name | Entity has nicknames |
| `entity_detail_remove_alias` | Remove specific alias | Cleaning up aliases |
| `entity_detail_add_tag` | Add categorization tag | Organizing entities |
| `entity_detail_remove_tag` | Remove specific tag | Untagging entities |
| `entity_detail_read_mentions` | See where entity appears | Finding references |
| `entity_detail_read_related` | See connected entities | Exploring relationships |
| `entity_detail_merge_with` | Combine two entities | Deduplicating entities |
| `entity_detail_read_appearances` | Find in integrations/chats | Cross-reference sources |
| `entity_detail_go_back` | Return to entity list | Finished viewing |

**Params:**
- Most tools: `entity_id` (string, optional - uses current if omitted)
- `entity_detail_set_description`: `description` (string) [REQUIRED]
- `entity_detail_add_alias`: `alias` (string) [REQUIRED]
- `entity_detail_remove_alias`: `alias` (string) [REQUIRED]
- `entity_detail_add_tag`: `tag` (string) [REQUIRED]
- `entity_detail_remove_tag`: `tag` (string) [REQUIRED]
- `entity_detail_read_mentions`: `limit` (number, 1-100, default 20)
- `entity_detail_read_related`: `limit` (number, 1-50, default 10)
- `entity_detail_merge_with`: `target_entity_id` (string) [REQUIRED], `strategy` ("merge"|"replace", default "merge")
- `entity_detail_read_appearances`: `include_integrations` (boolean, default true), `include_chats` (boolean, default true)

---

### 6. graph.ts (11 tools)

Knowledge graph visualization control (zoom, pan, filter, highlight).

| Tool | Description | When to Use |
|------|-------------|-------------|
| `graph_focus_node` | Center and zoom to node | "Show me the user node" |
| `graph_zoom_fit` | Fit all visible nodes | Returning to overview |
| `graph_select` | Open node inspector | Viewing node details |
| `graph_neighbors` | Highlight node + neighbors | Exploring local context |
| `graph_highlight` | Highlight without zoom | Marking important nodes |
| `graph_zoom_to` | Set zoom level (0.2-4) | Precise zoom control |
| `graph_path` | Highlight path between nodes | Tracing relationships |
| `graph_filter_layer` | Show only specific layer | Focusing on one node type |
| `graph_filter_integration` | Filter by integration | Integration-centric view |
| `graph_search` | Filter nodes by label | Finding nodes in graph |
| `graph_clear` | Remove all filters/resets | Clean slate |
| `graph_read_state` | Get current viewport state | Debugging graph view |

**Params:**
- `graph_focus_node`: `node_id` (string) [REQUIRED]
- `graph_select`: `node_id` (string, empty to close)
- `graph_neighbors`: `node_id` (string) [REQUIRED]
- `graph_highlight`: `node_id` (string, empty to clear)
- `graph_zoom_to`: `scale` (number, 0.2-4) [REQUIRED]
- `graph_path`: `from` (string) [REQUIRED], `to` (string) [REQUIRED]
- `graph_filter_layer`: `layer` ("user"|"integration"|"entity"|"memory"|"skill"|"workflow"|"") [REQUIRED]
- `graph_filter_integration`: `integration` (string) [REQUIRED]
- `graph_search`: `query` (string, empty to clear) [REQUIRED]

---

### 7. integration-detail.ts (10 tools)

Single integration management (purpose, category, co-usage).

| Tool | Description | When to Use |
|------|-------------|-------------|
| `integration_detail_read` | Get integration details | Loading integration info |
| `integration_detail_set_purpose` | Document usage intent | User explains why they use it |
| `integration_detail_read_co_used` | See commonly paired tools | Understanding tool clusters |
| `integration_detail_open_co_used` | Open related integration | Exploring connected tools |
| `integration_detail_read_recent_activities` | Get usage events | Checking recent activity |
| `integration_detail_configure` | Open settings panel | Configuring integration |
| `integration_detail_disconnect` | Remove integration | User wants to disconnect |
| `integration_detail_refresh_data` | Sync from server | Getting latest status |
| `integration_detail_read_category` | Get integration type | Categorizing tools |
| `integration_detail_go_back` | Return to integrations list | Navigation |

**Params:**
- `integration_detail_set_purpose`: `purpose` (string) [REQUIRED]
- `integration_detail_open_co_used`: `integration_slug` (string) [REQUIRED]
- `integration_detail_read_recent_activities`: `limit` (number, 1-50, default 10)
- `integration_detail_disconnect`: `confirm` (boolean, default false)

---

### 8. integrations.ts (12 tools)

Integration list browsing, filtering, and OAuth connection.

| Tool | Description | When to Use |
|------|-------------|-------------|
| `integrations_list_all` | Show connected integrations | Overview of all tools |
| `integrations_filter_by_category` | Filter by type (dev/comms/etc) | Finding tools by purpose |
| `integrations_sort_by_name` | A-Z sort | Scanning alphabetically |
| `integrations_sort_by_usage` | By co-usage frequency | Finding popular combinations |
| `integrations_search` | Find by name/slug | Quick lookup |
| `integrations_open_detail` | Open specific integration | Deep-dive on one tool |
| `integrations_refresh_list` | Sync from server | Fresh connection status |
| `integrations_read_co_used` | See co-usage patterns | Understanding workflows |
| `integrations_count_active` | Get active/total counts | Reporting connection status |
| `integrations_open_connect_manager` | Open OAuth manager | User wants to connect tool |
| `integrations_check_status` | Verify specific toolkit | Debugging connection |
| `integrations_connect_toolkit` | Start OAuth for specific | Connecting named tool |

**Params:**
- `integrations_filter_by_category`: `category` ("communication"|"dev"|"search"|"productivity"|"knowledge"|"other"|"all") [REQUIRED]
- `integrations_sort_by_name`: `ascending` (boolean, default true)
- `integrations_search`: `query` (string) [REQUIRED]
- `integrations_open_detail`: `slug` (string) [REQUIRED]
- `integrations_read_co_used`: `slug` (string, optional)
- `integrations_check_status`: `toolkit` (string) [REQUIRED]
- `integrations_connect_toolkit`: `toolkit` (string) [REQUIRED]

---

### 9. memories.ts (12 tools)

Memory list with filtering by type, tag, confidence, and recency.

| Tool | Description | When to Use |
|------|-------------|-------------|
| `memories_list` | Show all memories | Overview of stored memories |
| `memories_sort_by_confidence` | Highest confidence first | Finding reliable memories |
| `memories_sort_by_recency` | Newest first | Recent observations |
| `memories_set_limit` | Change display count (1-200) | View more/less memories |
| `memories_search` | Content substring search | Finding specific memory |
| `memories_filter_by_type` | Filter by memory type | Focusing on facts/goals/etc |
| `memories_filter_by_tag` | Filter by tag | Categorized memories |
| `memories_quick_add` | Open add-memory form | Creating new memory |
| `memories_read_related_entity` | Get associated entity | Understanding context |
| `memories_read_related_integration` | Get associated integration | Source tracking |
| `memories_refresh` | Sync from server | Fresh memory data |
| `memories_export_selected` | Save as JSON/CSV | Exporting memories |

**Params:**
- `memories_set_limit`: `limit` (number, 1-200, default 20) [REQUIRED]
- `memories_search`: `query` (string) [REQUIRED]
- `memories_filter_by_type`: `memory_type` ("fact"|"observation"|"preference"|"skill"|"goal"|"habit"|"insight"|"") [REQUIRED]
- `memories_filter_by_tag`: `tag` (string, empty to clear) [REQUIRED]
- `memories_quick_add`: `content` (string, optional), `memory_type` (string, optional), `confidence` (number 0-1, optional), `about_entity_id` (string, optional), `about_integration_slug` (string, optional)
- `memories_read_related_entity`: `memory_id` (string) [REQUIRED]
- `memories_read_related_integration`: `memory_id` (string) [REQUIRED]
- `memories_export_selected`: `format` ("json"|"csv", default "json"), `filename` (string, optional)

---

### 10. profile.ts (9 tools)

User profile CRUD (name, role, goals, preferences, context_window).

| Tool | Description | When to Use |
|------|-------------|-------------|
| `profile_read_all` | Get all profile fields | Loading user context |
| `profile_set_name` | Update display name | User introduces themselves |
| `profile_set_role` | Update position/title | Capturing role info |
| `profile_add_goal` | Append to goals list | User states objectives |
| `profile_remove_goal` | Remove by index (0-based) | Goal completed/changed |
| `profile_set_context_window` | Set token limit (512-200k) | Memory management |
| `profile_set_preference` | Set key-value pair | Custom preferences |
| `profile_remove_preference` | Remove by key | Cleaning up prefs |
| `profile_update_summary` | Update bio/description | About me section |

**Params:**
- `profile_set_name`: `name` (string, 1-100 chars) [REQUIRED]
- `profile_set_role`: `role` (string, 1-100 chars) [REQUIRED]
- `profile_add_goal`: `goal` (string, 1-500 chars) [REQUIRED]
- `profile_remove_goal`: `index` (number, 0+) [REQUIRED]
- `profile_set_context_window`: `context_window` (number, 512-200000) [REQUIRED]
- `profile_set_preference`: `key` (string, 1-100 chars) [REQUIRED], `value` (any) [REQUIRED]
- `profile_remove_preference`: `key` (string, 1-100 chars) [REQUIRED]
- `profile_update_summary`: `summary` (string, 1-2000 chars) [REQUIRED]

---

### 11. settings.ts (8 tools)

App settings and backend health monitoring.

| Tool | Description | When to Use |
|------|-------------|-------------|
| `settings_read_all` | Get all settings | Overview of configuration |
| `settings_set_userid` | Update user ID | Account switching |
| `settings_set_ui_mode` | windowed or chat | Mode switching |
| `settings_toggle_quiet_mode` | Reduce notifications | Focus mode |
| `settings_read_connections` | List integrations + status | Connection health |
| `settings_check_health` | Check SurrealDB/Composio | Debugging issues |
| `settings_open_connection_manager` | Open OAuth manager | Adding integrations |
| `settings_reset_preferences` | Clear to defaults | Factory reset (confirm=true) |

**Params:**
- `settings_set_userid`: `user_id` (string) [REQUIRED]
- `settings_set_ui_mode`: `mode` ("windowed"|"chat") [REQUIRED]
- `settings_toggle_quiet_mode`: `enabled` (boolean, optional - toggles if omitted)
- `settings_reset_preferences`: `confirm` (boolean) [REQUIRED - must be true]

---

### 12. skills.ts (12 tools)

Skill catalog browsing, filtering, and strength tracking.

| Tool | Description | When to Use |
|------|-------------|-------------|
| `skills_list_all` | Show all skills | Catalog overview |
| `skills_filter_by_min_strength` | Filter by skill level | Finding practiced skills |
| `skills_sort_by_strength` | Sort by proficiency | Strength-based ordering |
| `skills_sort_alphabetically` | A-Z or Z-A | Name-based ordering |
| `skills_search` | Find by name/description | Quick lookup |
| `skills_filter_by_tag` | Filter by category tag | Domain filtering |
| `skills_filter_by_integration` | Filter by required tool | Integration compatibility |
| `skills_read_detail` | Get skill steps | Understanding process |
| `skills_strengthen` | Increment strength | After successful use |
| `skills_refresh_list` | Sync from server | Fresh skill data |
| `skills_count_by_strength` | Distribution stats | Capability assessment |
| `skills_open_workflows_using` | See workflows with skill | Usage tracking |

**Params:**
- `skills_filter_by_min_strength`: `min_strength` (number, 0-100) [REQUIRED]
- `skills_sort_by_strength`: `direction` ("asc"|"desc", default "desc")
- `skills_sort_alphabetically`: `direction` ("asc"|"desc", default "asc")
- `skills_search`: `query` (string) [REQUIRED]
- `skills_filter_by_tag`: `tag` (string) [REQUIRED]
- `skills_filter_by_integration`: `integration` (string) [REQUIRED]
- `skills_read_detail`: `slug` (string) [REQUIRED]
- `skills_strengthen`: `slug` (string) [REQUIRED], `increment` (number, 1-10, default 1)
- `skills_open_workflows_using`: `slug` (string) [REQUIRED]

---

### 13. wiki.ts (13 tools)

Wiki page CRUD, navigation, and revision history.

| Tool | Description | When to Use |
|------|-------------|-------------|
| `wiki_read_page` | Get current page content | Reading documentation |
| `wiki_navigate_to` | Go to specific path | Link following |
| `wiki_edit_page` | Enter edit mode | Starting edits |
| `wiki_save_page` | Commit new revision | Saving changes |
| `wiki_cancel_edit` | Discard changes | Aborting edits |
| `wiki_list_children` | Show subpages | Exploring hierarchy |
| `wiki_go_to_parent` | Up one level | Navigation |
| `wiki_search` | Find pages by content | Discovery |
| `wiki_read_revision_history` | See past versions | Audit trail |
| `wiki_revert_to_revision` | Restore old version | Rollback |
| `wiki_new_page` | Create at path | Adding content |
| `wiki_delete_page` | Remove page | Cleanup (confirm=true) |
| `wiki_go_to_index` | Return to root | Home navigation |

**Params:**
- `wiki_navigate_to`: `path` (string) [REQUIRED]
- `wiki_save_page`: `content` (string) [REQUIRED], `edit_summary` (string, optional)
- `wiki_list_children`: `path` (string, optional)
- `wiki_search`: `query` (string) [REQUIRED], `limit` (number, 1-50, default 10)
- `wiki_read_revision_history`: `limit` (number, 1-100, default 20)
- `wiki_revert_to_revision`: `revision` (number|string) [REQUIRED], `reason` (string, optional)
- `wiki_new_page`: `path` (string) [REQUIRED], `content` (string, default ""), `title` (string, optional)
- `wiki_delete_page`: `confirm` (boolean) [REQUIRED - must be true]

---

### 14. window-management.ts (18 tools)

Window positioning, pinning, sizing, and layout presets.

**Position & Arrangement:**
| Tool | Description | When to Use |
|------|-------------|-------------|
| `winman_move_to_position` | Move to mount point | Precise positioning |
| `winman_arrange_preset` | Apply layout template | Quick arrangements |
| `winman_set_centre_arrangement` | Set center stage layout | Multi-window focus |
| `winman_swap_positions` | Exchange two windows | Reordering |

**Pinning:**
| Tool | Description | When to Use |
| `winman_pin_window` | Pin to left sideline | Protect from eviction |
| `winman_unpin_window` | Move to right sideline | Allow eviction |
| `winman_toggle_pin` | Flip pin state | Quick pin toggle |
| `winman_read_pinned` | List pinned windows | Checking protections |

**Focus & Z-Index:**
| Tool | Description | When to Use |
| `winman_bring_to_front` | Highest z-index | Focus window |
| `winman_send_to_back` | Lowest z-index | Background window |
| `winman_read_focused` | Get focused window info | Checking focus |

**Size & Resize:**
| Tool | Description | When to Use |
| `winman_resize_window` | Custom dimensions | Precise sizing |
| `winman_maximize_window` | Full-screen | Deep focus |
| `winman_minimize_window` | Picture-in-picture | Keep visible but small |

**Multi-Window Operations:**
| Tool | Description | When to Use |
| `winman_close_all_except` | Mass close with keep list | Cleanup |
| `winman_cascade_windows` | Stacked diagonal | Many windows view |
| `winman_tile_windows` | Grid arrangement | Equal visibility |

**State Readers:**
| Tool | Description | When to Use |
| `winman_read_layout_state` | Get layout overview | Debugging |
| `winman_read_window_list` | List all windows | Inventory |

**Params:**
- `winman_move_to_position`: `id` (string, optional), `kind` (WindowKind, optional), `mount` ("full"|"left-half"|"right-half"|"right-wide"|"top-half"|"bottom-half"|"left-third"|"center-third"|"right-third"|"tl"|"tr"|"bl"|"br"|"pip-br"|"pip-tr") [REQUIRED]
- `winman_arrange_preset`: `preset` ("focus"|"split"|"grid"|"stack-right"|"spotlight"|"theater"|"reading"|"triptych") [REQUIRED]
- `winman_set_centre_arrangement`: `arrangement` ("solo"|"split-2"|"split-3"|"grid-4") [REQUIRED]
- `winman_swap_positions`: `window1_id` (string, optional), `window1_kind` (WindowKind, optional), `window2_id` (string, optional), `window2_kind` (WindowKind, optional)
- `winman_pin_window`, `winman_unpin_window`, `winman_bring_to_front`, `winman_send_to_back`, `winman_maximize_window`, `winman_minimize_window`: `id` (string, optional), `kind` (WindowKind, optional)
- `winman_resize_window`: `id` (optional), `kind` (optional), `rect` ({x,y,w,h} 0-100%) [REQUIRED]
- `winman_close_all_except`: `keep_ids` (string[], default [])
- `winman_cascade_windows`: `offset` (number, 5-30, default 10)
- `winman_tile_windows`: `columns` (number, 1-6, optional)

---

### 15. workflows.ts (12 tools)

Workflow editor and execution for skill chains.

| Tool | Description | When to Use |
|------|-------------|-------------|
| `workflows_list_all` | Show all workflows | Catalog overview |
| `workflows_select` | Select for detail view | Viewing specific workflow |
| `workflows_new` | Open editor for new | Creating workflow |
| `workflows_edit` | Open editor pre-filled | Modifying workflow |
| `workflows_save` | Persist changes | Saving edits |
| `workflows_cancel_edit` | Discard and return | Aborting changes |
| `workflows_search` | Find by name/description | Quick lookup |
| `workflows_filter_by_tag` | Filter by category | Organized browsing |
| `workflows_sort_alphabetically` | A-Z ordering | Name-based scan |
| `workflows_read_skill_chain` | View ordered steps | Understanding process |
| `workflows_run` | Execute workflow | Running automation |
| `workflows_delete` | Remove (confirm=true) | Cleanup |
| `workflows_duplicate` | Copy as new | Template creation |

**Params:**
- `workflows_select`: `slug` (string) [REQUIRED]
- `workflows_edit`: `slug` (string, optional)
- `workflows_save`: `slug` (string) [REQUIRED], `name` (string) [REQUIRED], `description` (string) [REQUIRED], `trigger` (string, optional), `outcome` (string, optional), `frequency` (string, optional), `tags` (string[], optional), `skill_chain` ({slug, step_order}[], optional)
- `workflows_search`: `query` (string) [REQUIRED]
- `workflows_filter_by_tag`: `tag` (string, empty to clear) [REQUIRED]
- `workflows_sort_alphabetically`: `by` ("name"|"slug", default "name"), `ascending` (boolean, default true)
- `workflows_read_skill_chain`: `slug` (string, optional)
- `workflows_run`: `slug` (string, optional), `async` (boolean, default false)
- `workflows_delete`: `slug` (string, optional), `confirm` (boolean, default false) [MUST BE TRUE]
- `workflows_duplicate`: `source_slug` (string) [REQUIRED], `new_slug` (string) [REQUIRED], `new_name` (string, optional)

---

## Quick Reference Table

### Navigation Pattern

| Pattern | Example Tool | Required Params | Optional Params |
|---------|--------------|-----------------|-----------------|
| Search content | `{window}_search` | `query` | `case_sensitive`, `limit` |
| Filter by type | `{window}_filter_by_*` | `type`/`tag`/`source` | `clear_others` |
| Sort results | `{window}_sort_by_*` | - | `ascending`/`direction` |
| List all | `{window}_list_all` | - | - |
| Open detail | `{window}_open_detail` | `id`/`slug` | `name`, `type` |

### Read Pattern

| Pattern | Example Tool | Required Params | Optional Params |
|---------|--------------|-----------------|-----------------|
| Read full state | `{window}_read_all` | - | - |
| Read specific | `{window}_read_*` | `id` (sometimes) | `limit`, `include_*` |
| Get stats | `{window}_read_stats` | - | `include_inactive` |
| Get counts | `{window}_count_*` | - | - |

### Write Pattern

| Pattern | Example Tool | Required Params | Optional Params |
|---------|--------------|-----------------|-----------------|
| Create new | `{window}_new`/`quick_add` | - | `default_*` for prefill |
| Update field | `{window}_set_*` | value field | `entity_id` (optional) |
| Add item | `{window}_add_*` | item value | `entity_id` (optional) |
| Remove item | `{window}_remove_*` | key/index | `entity_id` (optional) |
| Delete | `{window}_delete` | `confirm: true` | `slug` (optional) |
| Save | `{window}_save` | primary fields | optional metadata |

### Layout Pattern

| Pattern | Example Tool | Required Params | Optional Params |
|---------|--------------|-----------------|-----------------|
| Move | `winman_move_to_position` | `mount` | `id`/`kind` |
| Arrange | `winman_arrange_preset` | `preset` | - |
| Resize | `winman_resize_window` | `rect` | `id`/`kind` |
| Pin/Unpin | `winman_pin/unpin_window` | - | `id`/`kind` |
| Focus | `winman_bring_to_front` | - | `id`/`kind` |
| Min/Max | `winman_maximize/minimize_window` | - | `id`/`kind` |

---

## Common Patterns

### Pattern 1: Search and Open

Finding something, then opening it for detail view.

```
// Search for an entity by name
entities_search({ query: "Alice" })
// → Returns: entity:person:alice123 (Alice Chen)

// Open the detail view
entities_open_detail({ entity_id: "entity:person:alice123", name: "Alice Chen" })
```

**Applies to:** entities, integrations, skills, workflows, memories, wiki

---

### Pattern 2: Filter and Sort

Narrowing results, then ordering them meaningfully.

```
// Filter to high-signal chats only
chatsummary_filter_by_signal_level({ filter_to: "high" })

// Sort by recency
chatsummary_sort_by_signal_level({ direction: "desc" })

// Get recent high-signal chats
chatsummary_read_recent({ limit: 10 })
```

**Applies to:** chats_summary, memories, skills, entities, workflows

---

### Pattern 3: Multi-Step Workflow

Creating or editing a complex item across multiple tool calls.

```
// 1. Start creation
workflows_new()

// 2. Save with basic info
workflows_save({
  slug: "daily-standup",
  name: "Daily Standup Summary",
  description: "Summarize yesterday's activity"
})

// 3. Select to edit skill chain
workflows_select({ slug: "daily-standup" })
workflows_edit({ slug: "daily-standup" })

// 4. Save with full skill chain
workflows_save({
  slug: "daily-standup",
  name: "Daily Standup Summary",
  description: "Summarize yesterday's activity",
  skill_chain: [
    { slug: "fetch-commits", step_order: 1 },
    { slug: "summarize-activity", step_order: 2 }
  ]
})
```

**Applies to:** workflows, wiki pages, entities

---

### Pattern 4: Cross-Window Navigation

Moving between related windows for different perspectives.

```
// Start in chat summary
chatsummary_filter_by_source({ source: "slack" })
chatsummary_read_recent({ limit: 5 })

// Jump to full chat view
chatsummary_jump_to_full_chat({ chat_id: "slack:thread:abc123" })

// Search within that chat
chat_search_messages({ query: "deadline" })

// Scroll to relevant context
chat_scroll_to_bottom()
```

**Applies to:** chats_summary ↔ chat, entities ↔ entity_detail, integrations ↔ integration_detail

---

### Pattern 5: Integration Discovery and Connection

Finding, checking, and connecting integrations.

```
// Search for integration
integrations_search({ query: "github" })

// Check current status
integrations_check_status({ toolkit: "github" })
// → "github: not connected"

// Open connection manager
integrations_open_connect_manager()

// Or directly initiate connection
integrations_connect_toolkit({ toolkit: "github" })
```

---

### Pattern 6: Layout for Focus

Arranging windows for specific work modes.

```
// Research mode: Graph + Entity detail side by side
winman_arrange_preset({ preset: "split" })
graph_focus_node({ node_id: "ent-project-alpha" })
entities_open_detail({ entity_id: "entity:project:alpha" })

// Deep work: Maximize entity detail
winman_maximize_window({ kind: "entity_detail" })

// Overview mode: All windows tiled
winman_tile_windows({ columns: 3 })
```

---

### Pattern 7: Entity Enrichment

Building up entity information over time.

```
// Open entity
entities_open_detail({ entity_id: "entity:person:bob456" })

// Add context
entity_detail_set_description({ 
  description: "Backend engineer working on API v2" 
})

// Add variations of name
entity_detail_add_alias({ alias: "Bobby" })
entity_detail_add_alias({ alias: "Robert" })

// Categorize
entity_detail_add_tag({ tag: "backend-team" })
entity_detail_add_tag({ tag: "api-expert" })

// Check where mentioned
entity_detail_read_mentions({ limit: 10 })
entity_detail_read_related({ limit: 5 })
```

---

## Window-Specific Details

### Ask User Modal

The `ask_user` window is special — it's a modal dialog, not a regular window.

**Key behaviors:**
- Must use `askuser_await_response` to signal waiting state
- Options limited to 4 choices max
- Can position at center, bottom, or corner
- Priority affects visual styling (low=dim, high=prominent)

**Typical flow:**
```
askuser_set_question({ question: "Which project?" })
askuser_set_options({ options: ["Alpha", "Beta", "Gamma"] })
askuser_await_response()
// ... wait for user selection ...
askuser_read_response()  // Returns selected index
```

---

### Graph Canvas

The graph supports node types: `user`, `integration`, `entity`, `memory`, `skill`, `workflow`.

**Node ID format:**
- User: `user-{id}`
- Integration: `integration-{slug}`
- Entity: `ent-{name}`
- Memory: `mem-{id}`
- Skill: `skill-{slug}`
- Workflow: `wf-{slug}`

**Visual states:**
- `focus_node`: Centers + zooms to node
- `neighbors`: Highlights node + 1-hop connections
- `highlight`: Highlights without zoom change
- `path`: Shows shortest path between two nodes

---

### Wiki Hierarchy

Wiki paths use `/` separator (e.g., `docs/getting-started`, `projects/roadmap`).

**Navigation:**
- `wiki_navigate_to({ path: "docs/api" })` - absolute path
- `wiki_go_to_parent()` - up one level
- `wiki_go_to_index()` - to root
- `wiki_list_children()` - explore subpages

**Editing flow:**
```
wiki_read_page()          // View current
wiki_edit_page()          // Enter edit mode
wiki_save_page({          // Commit changes
  content: "# New content",
  edit_summary: "Added API section"
})
// Or cancel:
wiki_cancel_edit()
```

---

### Window Mount Points

Available positions for `winman_move_to_position`:

| Mount Point | Description | Best For |
|-------------|-------------|----------|
| `full` | Entire canvas | Deep focus |
| `left-half` | 50% left | Split view left |
| `right-half` | 50% right | Split view right |
| `right-wide` | 60% right | Main content + sidebar |
| `top-half` | 50% top | Stacked top |
| `bottom-half` | 50% bottom | Stacked bottom |
| `left-third` | 33% left | Triptych left |
| `center-third` | 33% center | Triptych center |
| `right-third` | 33% right | Triptych right |
| `tl` | Top-left quadrant | Quad view |
| `tr` | Top-right quadrant | Quad view |
| `bl` | Bottom-left quadrant | Quad view |
| `br` | Bottom-right quadrant | Quad view |
| `pip-br` | 25%x30% bottom-right | Floating video-style |
| `pip-tr` | 25%x30% top-right | Notifications |

---

## Summary

This reference covers 166 tools across 15 window tool files:

1. **ask-user.ts** - Modal dialogs
2. **chat.ts** - Chat navigation
3. **chats-summary.ts** - Chat aggregation
4. **entities.ts** - Entity lists
5. **entity-detail.ts** - Individual entities
6. **graph.ts** - Graph visualization
7. **integration-detail.ts** - Single integrations
8. **integrations.ts** - Integration lists
9. **memories.ts** - Memory management
10. **profile.ts** - User profile
11. **settings.ts** - App settings
12. **skills.ts** - Skill catalog
13. **wiki.ts** - Wiki pages
14. **window-management.ts** - Layout control
15. **workflows.ts** - Workflow editor

All tools follow the pattern: validate with Zod → emit AgentEvents → apply to server snapshot → return descriptive message.
