$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectDirectory = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectDirectory 'public/pwa'
$fontPath = Join-Path $projectDirectory 'node_modules/primeicons/fonts/primeicons.ttf'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$fonts = [System.Drawing.Text.PrivateFontCollection]::new()
$fonts.AddFontFile($fontPath)

try {
    foreach ($icon in @(
        @{ Name = 'icon-192.png'; Size = 192; Scale = 0.62 },
        @{ Name = 'icon-512.png'; Size = 512; Scale = 0.62 },
        @{ Name = 'maskable-512.png'; Size = 512; Scale = 0.50 }
    )) {
        $bitmap = [System.Drawing.Bitmap]::new($icon.Size, $icon.Size)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $font = [System.Drawing.Font]::new($fonts.Families[0], [single]($icon.Size * $icon.Scale), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        $format = [System.Drawing.StringFormat]::new()
        try {
            $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#10b981'))
            $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
            $format.Alignment = [System.Drawing.StringAlignment]::Center
            $format.LineAlignment = [System.Drawing.StringAlignment]::Center
            $rectangle = [System.Drawing.RectangleF]::new(0, 0, $icon.Size, $icon.Size)
            $graphics.DrawString([string][char]0xe9d9, $font, [System.Drawing.Brushes]::White, $rectangle, $format)
            $bitmap.Save((Join-Path $outputDirectory $icon.Name), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $format.Dispose()
            $font.Dispose()
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally {
    $fonts.Dispose()
}
