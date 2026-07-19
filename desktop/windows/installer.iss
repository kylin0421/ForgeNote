#ifndef AppVersion
  #define AppVersion "0.1.5"
#endif
#ifndef SourceDir
  #error SourceDir must point to the staged ForgeNote directory
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#ifndef ProjectRoot
  #define ProjectRoot "..\.."
#endif

[Setup]
AppId={{55D7A234-8643-4709-B807-7A4B5051863C}
AppName=ForgeNote
AppVersion={#AppVersion}
AppPublisher=ForgeNote Team
DefaultDirName={localappdata}\Programs\ForgeNote
DefaultGroupName=ForgeNote
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=ForgeNote-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#ProjectRoot}\frontend\src\app\favicon.ico
UninstallDisplayIcon={app}\ForgeNote.exe
LicenseFile={#ProjectRoot}\LICENSE
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\ForgeNote"; Filename: "{app}\ForgeNote.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\ForgeNote"; Filename: "{app}\ForgeNote.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标："; Flags: unchecked

[Run]
Filename: "{app}\ForgeNote.exe"; Description: "启动ForgeNote"; Flags: nowait postinstall skipifsilent
