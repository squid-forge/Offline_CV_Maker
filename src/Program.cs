using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;
using System.Reflection;
using System.Runtime.InteropServices;

[assembly: AssemblyTitle("Local CV Maker")]
[assembly: AssemblyProduct("Local CV Maker")]
[assembly: AssemblyVersion("0.2.0.0")]

internal static class Program
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AllocConsole();

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--mcp")
        {
            Mcp.Run();
            return;
        }
        bool headless = args.Length == 1 && args[0] == "--serve";
        using (var server = new LocalServer())
        {
            try { server.Start(); }
            catch (SocketException)
            {
                if (!headless && AppIsRunning()) OpenBrowser();
                else if (!headless) MessageBox.Show("The local port is busy. Close the other app and try again.", "Local CV Maker", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (headless)
            {
                Thread.Sleep(Timeout.Infinite);
                return;
            }
            if (AllocConsole())
            {
                Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true });
                Console.Title = "Local CV Maker - Logs";
            }
            Log("Local CV Maker is listening at " + LocalServer.Url + "/");
            Log("MCP is available through Connect AI. Use the tray menu to quit.");
            Application.EnableVisualStyles();
            using (var menu = new ContextMenuStrip())
            using (var tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "Local CV Maker", ContextMenuStrip = menu, Visible = true })
            {
                menu.Items.Add("Open CV Maker", null, delegate { OpenBrowser(); });
                menu.Items.Add("Quit", null, delegate { Application.ExitThread(); });
                tray.DoubleClick += delegate { OpenBrowser(); };
                OpenBrowser();
                Application.Run();
                tray.Visible = false;
                Log("Local CV Maker is shutting down.");
            }
        }
    }

    internal static void Log(string message)
    {
        try { Console.WriteLine("[{0:HH:mm:ss}] {1}", DateTime.Now, message); }
        catch (IOException) { }
    }

    private static bool AppIsRunning()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(LocalServer.Url + "/");
            req.Method = "HEAD";
            req.Proxy = null;
            req.AllowAutoRedirect = false;
            req.Timeout = 1200;
            using (var response = req.GetResponse()) return response.Headers["X-Local-CV-Maker"] == "3";
        }
        catch (WebException) { return false; }
    }

    private static void OpenBrowser()
    {
        try { Process.Start(new ProcessStartInfo(LocalServer.Url + "/") { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception)
        {
            MessageBox.Show("Open " + LocalServer.Url + "/ in a browser.", "Local CV Maker");
        }
    }
}
