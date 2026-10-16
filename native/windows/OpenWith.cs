using System;
using System.IO;
using System.Runtime.InteropServices;

internal static class OpenWith
{
    [Flags]
    private enum OpenAsFlags : uint
    {
        OAIF_EXEC = 0x00000004,
        OAIF_HIDE_REGISTRATION = 0x00000020
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct OPENASINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pcszFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pcszClass;
        public OpenAsFlags oaifInFlags;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, PreserveSig = true)]
    private static extern int SHOpenWithDialog(IntPtr hwndParent, ref OPENASINFO info);

    private static bool IsDocument(string filename)
    {
        string extension = Path.GetExtension(filename).ToLowerInvariant();
        switch (extension)
        {
            case ".md": case ".html": case ".htm": case ".txt": case ".csv":
            case ".pdf": case ".epub": case ".docx": case ".png": case ".jpg":
            case ".jpeg": case ".gif": case ".webp": case ".bmp":
            case ".rtf": case ".doc": case ".xls": case ".xlsx": case ".ppt":
            case ".pptx": case ".odt": case ".ods": case ".odp":
                return true;
            case ".json":
                return filename.EndsWith(".mindmap.json", StringComparison.OrdinalIgnoreCase);
            default:
                return false;
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 1 || !Path.IsPathRooted(args[0])) return 1;
            string root = Path.GetPathRoot(args[0]);
            // Reject drive-relative, root-relative, device, and alternate-stream paths.
            if (root.Length < 3 || args[0].StartsWith(@"\\?\", StringComparison.Ordinal) ||
                args[0].StartsWith(@"\\.\", StringComparison.Ordinal) ||
                args[0].Substring(root.Length).IndexOf(':') >= 0) return 1;
            string filename = Path.GetFullPath(args[0]);
            if (!IsDocument(filename)) return 1;
            FileAttributes attributes = File.GetAttributes(filename);
            if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint | FileAttributes.Device)) != 0)
                return 1;
            using (FileStream file = File.Open(filename, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                // Do not hand a renamed Windows executable to the chooser.
                if (file.ReadByte() == 'M' && file.ReadByte() == 'Z') return 1;
            }
            OPENASINFO info = new OPENASINFO();
            info.pcszFile = filename;
            // Default-app changes belong in Windows Settings, not this dialog.
            info.oaifInFlags = OpenAsFlags.OAIF_EXEC | OpenAsFlags.OAIF_HIDE_REGISTRATION;
            int result = SHOpenWithDialog(IntPtr.Zero, ref info);
            if (result == unchecked((int)0x800704C7)) return 2;
            return result < 0 ? 1 : 0;
        }
        catch
        {
            return 1;
        }
    }
}
