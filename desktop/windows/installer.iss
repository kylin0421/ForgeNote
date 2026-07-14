#ifndef AppVersion
  #define AppVersion "0.1.4"
#endif
#ifndef SourceDir
  #error SourceDir must point to the staged ZhiXue directory
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#ifndef ProjectRoot
  #define ProjectRoot "..\.."
#endif

[Setup]
AppId={{55D7A234-8643-4709-B807-7A4B5051863C}
AppName=智学工坊
AppVersion={#AppVersion}
AppPublisher=ZhiXue Team
DefaultDirName={localappdata}\Programs\ZhiXue
DefaultGroupName=智学工坊
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=ZhiXue-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#ProjectRoot}\frontend\src\app\favicon.ico
UninstallDisplayIcon={app}\ZhiXue.exe
LicenseFile={#ProjectRoot}\LICENSE
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\智学工坊"; Filename: "{app}\ZhiXue.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\智学工坊"; Filename: "{app}\ZhiXue.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标："; Flags: unchecked

[Run]
Filename: "{app}\ZhiXue.exe"; Description: "启动智学工坊"; Flags: nowait postinstall skipifsilent
