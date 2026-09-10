# Canvas Map Pins 

This plugin extends the Canvas Plugin and the JSON Canvas format by adding Map Pins.

To add a map pin in a canvas either use the "add-canvas-map-pin" command or click/drag the map pin icon in the canvas "Card Menu".

## Map Pin functionality

- Can be placed on any image type
- Hover to see the name
- Click to open a preview of the linked file
- Right-click to do anything else :)

## Settings

### Map Pin size

Measured in canvas pixels, this sets how big the pins appear.

### Filename Template

When you create a map pin, it will prompt you to name the pin. Based on this name, the pin will link to or create a file with the generated filename.
The Filename Template will generate the filename.

E.g.
Pin name: "Gondor", template: "%n (map pin)", filename: "Gondor (map pin).md"