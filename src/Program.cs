using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;
using System.Reflection;

[assembly: AssemblyTitle("Local CV Maker")]
[assembly: AssemblyProduct("Local CV Maker")]
[assembly: AssemblyVersion("0.2.0.0")]
[assembly: AssemblyInformationalVersion(Program.AppVersion)]

internal static class Program
{
    internal const string AppVersion = "0.2.0-alpha.1";
    private static volatile ActivityWindow activity;

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
                if (!headless && IsCurrentServer()) OpenBrowser(Credentials.Token(Credentials.StoredSecret, "browser"));
                else if (!headless) MessageBox.Show("The local port is busy. Close the other app and try again.", "Local CV Maker", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (headless)
            {
                Thread.Sleep(Timeout.Infinite);
                return;
            }
            Application.EnableVisualStyles();
            Action openBrowser = delegate { OpenBrowser(server.BrowserToken); };
            using (var activityWindow = new ActivityWindow(openBrowser))
            using (var menu = new ContextMenuStrip())
            using (var tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "Local CV Maker", ContextMenuStrip = menu, Visible = true })
            {
                activity = activityWindow;
                Log("Editor ready.");
                menu.Items.Add("Open CV Maker", null, delegate { openBrowser(); });
                menu.Items.Add("Activity", null, delegate
                {
                    activityWindow.Show();
                    activityWindow.WindowState = FormWindowState.Normal;
                    activityWindow.Activate();
                });
                menu.Items.Add("Quit", null, delegate { Application.ExitThread(); });
                tray.DoubleClick += delegate { openBrowser(); };
                activityWindow.Show();
                openBrowser();
                Application.Run();
                tray.Visible = false;
                activity = null;
            }
        }
    }

    internal static void Log(string message)
    {
        var window = activity;
        if (window != null) window.Record(message);
    }

    internal static bool IsCurrentServer()
    {
        var secret = Credentials.StoredSecret;
        if (secret == null) return false;
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(LocalServer.Url + "/");
            req.Method = "HEAD";
            req.Proxy = null;
            req.AllowAutoRedirect = false;
            req.Timeout = 1200;
            string challenge = Credentials.Token(Credentials.NewSecret(), "challenge");
            req.Headers.Add("X-CV-Challenge", challenge);
            using (var response = req.GetResponse())
                return response.Headers["X-Local-CV-Maker"] == Credentials.ServerVersion &&
                    response.Headers["X-CV-Proof"] == Credentials.Token(secret, "server:" + challenge);
        }
        catch (WebException) { return false; }
    }

    private static void OpenBrowser(string token)
    {
        try { Process.Start(new ProcessStartInfo(LocalServer.Url + "/#session=" + token) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception)
        {
            MessageBox.Show("No default browser could be opened. Choose a default browser and reopen the editor from the system tray.", "Local CV Maker");
        }
    }
}

internal sealed class ActivityWindow : Form
{
    private const int HistoryLimit = 100;
    private readonly ConcurrentQueue<string> pending = new ConcurrentQueue<string>();
    private readonly Queue<string> history = new Queue<string>();
    private readonly TextBox log;
    private readonly System.Windows.Forms.Timer refresh;

    internal ActivityWindow(Action openEditor)
    {
        Text = "Local CV Maker - Activity";
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = SystemFonts.MessageBoxFont;
        ClientSize = new Size(428, 216);
        MinimumSize = new Size(344, 198);
        StartPosition = FormStartPosition.CenterScreen;
        Icon = SystemIcons.Application;

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Padding = new Padding(14) };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(new Label
        {
            Text = "Reopen Activity from the system tray.",
            AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 9),
        }, 0, 0);
        log = new TextBox
        {
            AccessibleName = "Recent activity", Multiline = true, ReadOnly = true, Dock = DockStyle.Fill,
            ScrollBars = ScrollBars.Vertical, BackColor = SystemColors.Window, Margin = Padding.Empty,
        };
        layout.Controls.Add(log, 0, 1);
        var actions = new FlowLayoutPanel
        {
            AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false, Padding = new Padding(0, 6, 0, 0), Margin = Padding.Empty,
        };
        var actionSize = new Size(92, 30);
        var hide = new Button { Text = "Hide", AutoSize = true, MinimumSize = actionSize };
        hide.Click += delegate { Hide(); };
        var open = new Button { Text = "Open editor", AutoSize = true, MinimumSize = actionSize };
        open.Click += delegate { openEditor(); };
        actions.Controls.Add(hide);
        actions.Controls.Add(open);
        layout.Controls.Add(actions, 0, 2);
        Controls.Add(layout);

        refresh = new System.Windows.Forms.Timer { Interval = 250 };
        refresh.Tick += delegate { ShowRecentActivity(); };
        refresh.Start();
    }

    internal void Record(string message)
    {
        pending.Enqueue(String.Format("{0:t}   {1}", DateTime.Now, message));
    }

    private void ShowRecentActivity()
    {
        string line;
        if (!pending.TryDequeue(out line)) return;
        for (int count = 1; ; count++)
        {
            if (history.Count == HistoryLimit) history.Dequeue();
            history.Enqueue(line);
            if (count == HistoryLimit || !pending.TryDequeue(out line)) break;
        }
        log.Lines = history.ToArray();
        log.SelectionStart = log.TextLength;
        log.ScrollToCaret();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        base.OnFormClosing(e);
        if (e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && refresh != null) refresh.Dispose();
        base.Dispose(disposing);
    }
}
