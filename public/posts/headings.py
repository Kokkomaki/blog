#!/usr/bin/env python3
"""
Batch process Markdown headings in Hugo posts:

- Recursively scans all folders under POSTS_DIR
- Only modifies index.md files
- Converts all headings (#, ###, etc.) to level 2 (##)
- Removes any leading numbers from headings (e.g., "1. Introduction" → "Introduction")
- Capitalizes the first letter of each heading
- Creates a backup (.bak) before overwriting
"""

import os
import re
import shutil

# 🧭 Set this to your Hugo posts folder
POSTS_DIR = "/Users/villekokkomaki/Documents/blog/content/posts"

# Regex to match Markdown headings (any level) and capture the heading text
HEADING_PATTERN = re.compile(r'^(#+)\s+(.*)', re.MULTILINE)

# Regex to remove leading numbers (e.g., "1. Introduction" → "Introduction")
LEADING_NUM_PATTERN = re.compile(r'^\s*\d+(\.\d+)*[)\.\-\s]+\s*')

def clean_heading_text(text):
    """Remove leading numbers and capitalize the first letter"""
    # Remove numbers at the start
    text = LEADING_NUM_PATTERN.sub('', text.strip())
    if text:
        # Capitalize first letter
        text = text[0].upper() + text[1:]
    return text

def convert_headings_to_h2(content):
    """Convert all headings to ##, clean text, and capitalize first letter"""
    def repl(match):
        heading_text = clean_heading_text(match.group(2))
        return f"## {heading_text}"
    return HEADING_PATTERN.sub(repl, content)

def process_file(path):
    """Convert headings in a single file and create backup"""
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    new_content = convert_headings_to_h2(content)

    if new_content != content:
        backup_path = path + ".bak"
        shutil.copy(path, backup_path)  # Backup original
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"✅ Converted headings in {path}, backup saved as {backup_path}")
    else:
        print(f"ℹ️ No headings to convert in {path}")

def main():
    if not os.path.isdir(POSTS_DIR):
        print(f"❌ POSTS_DIR not found: {POSTS_DIR}")
        return

    for root, _, files in os.walk(POSTS_DIR):
        for file in files:
            if file == "index.md":
                process_file(os.path.join(root, file))

    print("\n🎉 Done! All headings converted to ##, numbers removed, first letter capitalized.")

if __name__ == "__main__":
    main()
