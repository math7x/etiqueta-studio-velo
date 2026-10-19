$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$javaBin = 'C:\Program Files (x86)\Java\jdk1.7.0_80\bin'
$jasperLib = 'C:\Program Files (x86)\Jaspersoft\iReport-3.7.2\ireport\modules\ext'
$classes = Join-Path $appRoot 'build'
New-Item -ItemType Directory -Force -Path $classes | Out-Null
& "$javaBin\javac.exe" -encoding UTF-8 -source 1.7 -target 1.7 -cp "$jasperLib\*" -d $classes (Join-Path $PSScriptRoot 'EtiquetaStudio.java')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar Java.' }
$jarArguments = @('cf', (Join-Path $appRoot 'EtiquetaStudio.jar'))
foreach ($classFile in Get-ChildItem -LiteralPath $classes -Filter *.class -File) { $jarArguments += @('-C', $classes, $classFile.Name) }
& "$javaBin\jar.exe" @jarArguments
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar JAR.' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$payload = Join-Path $classes 'EtiquetaStudio-payload.zip'
$archiveStream = [IO.File]::Open($payload, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($archiveStream, [IO.Compression.ZipArchiveMode]::Create)
try {
  $runtimeRoot = Join-Path (Split-Path $javaBin -Parent) 'jre'
  foreach ($runtimeFile in Get-ChildItem -LiteralPath $runtimeRoot -Recurse -File) {
    $relative = $runtimeFile.FullName.Substring($runtimeRoot.Length + 1).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $runtimeFile.FullName, ('java/' + $relative), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  foreach ($libraryFile in Get-ChildItem -LiteralPath $jasperLib -Filter *.jar -File) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $libraryFile.FullName, ('lib/' + $libraryFile.Name), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  foreach ($assetFile in Get-ChildItem -LiteralPath (Join-Path $appRoot 'app') -File) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $assetFile.FullName, ('app/' + $assetFile.Name), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  foreach ($desktopFile in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'webview') -File) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $desktopFile.FullName, ('desktop/' + $desktopFile.Name), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $appRoot 'EtiquetaStudio.jar'), 'EtiquetaStudio.jar', [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $appRoot 'modelos\A4-exemplo-3-colunas.jrxml'), 'modelo-teste.jrxml', [IO.Compression.CompressionLevel]::Optimal) | Out-Null
} finally { $archive.Dispose(); $archiveStream.Dispose() }
& 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' /nologo /target:winexe /platform:x64 ('/out:' + (Join-Path $appRoot 'Etiqueta Studio.exe')) /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll ('/reference:' + (Join-Path $PSScriptRoot 'webview\Microsoft.Web.WebView2.Core.dll')) ('/reference:' + (Join-Path $PSScriptRoot 'webview\Microsoft.Web.WebView2.WinForms.dll')) ('/resource:' + $payload + ',EtiquetaStudio.Payload') (Join-Path $PSScriptRoot 'Launcher.cs') (Join-Path $PSScriptRoot 'EditorWindow.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar iniciador.' }
Write-Output 'Compilação concluída: EXE único com Java, JasperReports e interface incorporados.'
