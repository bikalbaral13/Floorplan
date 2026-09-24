/** Patch Builderpluss Main.rb so its toolbar reliably appears. Preserves CRLF. */
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
let s = readFileSync(file, "utf8");
const EOL = "\r\n";

if (s.includes("BP_TOOLBAR_SHOW")) {
  console.log("already patched");
  process.exit(0);
}

// 1. Deferred show. Calling show() during plugin load can land before SketchUp's UI is ready; the
//    toolbar is then created and populated but never displayed, which is exactly the symptom.
//    restore() honours the saved shown/hidden state, so show() follows it to force it visible once.
const showLine = s.match(/^([ \t]*)toolbar\.show[ \t]*$/m);
if (!showLine) throw new Error("toolbar.show not found");
const ind = showLine[1];
const replacement = [
  `${ind}# BP_TOOLBAR_SHOW - deferred on purpose. Calling show() while this file is still loading can run`,
  `${ind}# before SketchUp's UI exists, leaving the toolbar built but never displayed. A zero-repeat timer`,
  `${ind}# runs it once startup has settled; restore() first so a docked position is kept.`,
  `${ind}UI.start_timer(0.1, false) do`,
  `${ind}  begin`,
  `${ind}    toolbar.restore`,
  `${ind}    toolbar.show`,
  `${ind}  rescue StandardError => e`,
  `${ind}    puts "Builderpluss: toolbar could not be shown - #{e.message}"`,
  `${ind}  end`,
  `${ind}end`,
].join(EOL);
s = s.replace(showLine[0], replacement);

// 2. One failing command must not abort the whole block. Every create_menu_item runs before
//    toolbar.show, so a single raise (a missing icon, a renamed method) silently costs the toolbar.
const def = s.match(/^([ \t]*)def self\.create_menu_item\(name, tooltip,menu=nil,toolbar=nil\)[ \t]*$/m);
if (!def) throw new Error("create_menu_item definition not found");
const d = def[1];
const body = [
  `${d}def self.create_menu_item(name, tooltip,menu=nil,toolbar=nil)`,
  `${d}  cmd = UI::Command.new(name) { self.send(name) }`,
  `${d}  # Guarded: a missing or unreadable icon must cost this one button, not every button after it`,
  `${d}  # and the toolbar itself.`,
  `${d}  begin`,
  `${d}    icon = @icons_path + name + ".png"`,
  `${d}    if File.exist?(icon)`,
  `${d}      cmd.small_icon = icon`,
  `${d}      cmd.large_icon = icon`,
  `${d}    else`,
  `${d}      puts "Builderpluss: no icon for #{name} (#{icon})"`,
  `${d}    end`,
  `${d}  rescue StandardError => e`,
  `${d}    puts "Builderpluss: icon failed for #{name} - #{e.message}"`,
  `${d}  end`,
  `${d}  cmd.tooltip = tooltip`,
  `${d}  cmd.status_bar_text = tooltip`,
  `${d}  cmd.menu_text = tooltip`,
  `${d}  menu.add_item(cmd)  if menu`,
  `${d}  toolbar.add_item(cmd) if toolbar`,
  `${d}rescue StandardError => e`,
  `${d}  puts "Builderpluss: could not add #{name} - #{e.message}"`,
  `${d}end`,
].join(EOL);

// Replace from the def line through its matching `end` (the original body is 10 lines).
const start = s.indexOf(def[0]);
const after = s.indexOf(`${d}end`, start);
if (after < 0) throw new Error("create_menu_item end not found");
s = s.slice(0, start) + body + s.slice(after + `${d}end`.length);

writeFileSync(file, s);
console.log("patched");
