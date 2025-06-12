# Prompt Template Manager

A powerful VS Code extension designed to streamline AI-assisted development by managing reusable prompt templates with dynamic variable substitution and file content integration capabilities.

## Overview

Prompt Template Manager addresses the common challenge of repeatedly crafting similar prompts for AI assistance. Instead of writing "Tell me about cow sounds," "Tell me about chicken lifespan," and "Tell me about hippo weight" from scratch each time, you can create a single template like `"Tell me about {animal}'s {feature}"` and simply fill in the variables when needed.

## Features

### ✅ Core Features (Implemented)

- **📝 Prompt Management**: Save, edit, and organize frequently used prompt templates
- **🔍 Smart Search**: Quickly find prompts from your collection
- **📊 Usage Tracking**: Automatic sorting by usage frequency
- **💾 Global Storage**: Prompts are available across all VS Code workspaces
- **📤 Export/Import**: Backup and share your prompt collections with selective export and instant refresh

### ✅ File Content Integration

When you select a file using the 📁 button for a variable, the extension automatically:

- Opens a file selection dialog to choose files
- Reads the selected file content
- Formats it in a structured XML format expected by AI tools
- Handles both workspace-relative and absolute file paths
- Displays the file reference as `@filename` in the variable input

Example workflow:

```
1. Create a prompt: "Please review {code_file}"
2. Click the 📁 button next to the code_file variable
3. Select a file (e.g., main.ts) from the dialog
4. The variable input shows: @main.ts
5. When executed, it expands to:

```

````XML
Please review
<additional_data>
<attached_files>
<file_contents>
```path=project-name/main.ts
[actual file content here]
```

</file_contents>
</attached_files>
</additional_data>

````

### ✅ User Experience Enhancements

- **🎭 Activity Bar Integration**: Custom PTM icon in the activity bar for quick access
- **📤 Export/Import Buttons**: Direct access to export and import functions from activity bar
- **⚡ Button Animations**: Visual feedback for all interactions
- **🔄 State Persistence**: Maintains context when switching between windows
- **🎨 Modern UI**: Beautiful, responsive interface with VS Code theming

## Usage

### Basic Usage

1. **Open the Manager**:

   - Use Command Palette (`Ctrl+Shift+P`) → "Open Prompt Template Manager"
   - Click the PTM icon in the activity bar
   - Use the command "Create New Prompt" for quick creation

2. **Create a Prompt**:

   - Click "New Prompt" in the interface
   - Enter a descriptive title
   - Write your prompt content with variables like `{variable:default_value}`

3. **Use Variables**:
   - Variables are automatically detected in `{variable}` format
   - Set default values with `{variable:default_value}` syntax
   - Fill in values using the right panel interface

### File Integration

1. **Select Files**: Click the 📁 button next to variable inputs to open file selection dialog
2. **File Reference**: Selected files are automatically referenced as `@filename` in the variable
3. **Set Defaults**: Use the 📌 button to save current values as defaults

### Export & Import

1. **Export Prompts**:

   - Click the 📤 "Export Prompts" button in the activity bar
   - Select which prompts to export from the multi-selection dialog
   - Choose save location for the JSON file
   - Share the exported file with team members

2. **Import Prompts**:
   - Click the 📥 "Import Prompts" button in the activity bar
   - Select a JSON file containing prompt data
   - Prompts are instantly added and UI refreshes automatically
   - Duplicate prompts are automatically skipped with notification

### Advanced Features

- **Export/Import**: Share prompt collections with team members
- **Statistics**: View usage statistics and storage information
- **Search**: Use the search functionality to quickly find specific prompts

## Installation

1. Install from VS Code Marketplace (when published)
2. Or install from VSIX file during development

## Requirements

- VS Code version 1.74.0 or higher
- No additional dependencies required
