using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal static class CvContract
{
    internal const int Limit = 768 * 1024;
    internal static readonly string[] TextFields = { "headline", "about", "motherTongue", "skills" };
    internal static readonly string[] Groups = { "work", "education", "projects", "languages" };
    internal static readonly string[] Sections = { "about", "education", "projects", "work", "skills", "languages" };
    internal static readonly string[] Levels = { "", "A1", "A2", "B1", "B2", "C1", "C2" };
    internal static readonly string[] EntryFields = { "title", "organisation", "dates", "description" };
    internal static readonly string[] LevelFields = { "listening", "reading", "production", "interaction", "writing" };
    internal static readonly string[] BlockFields = TextFields.Concat(EntryFields).Concat(LevelFields).Concat(new[] { "body" }).ToArray();
    internal const int MaxCustomSections = 30;
    internal const string CustomSectionPattern = "^custom-[1-9][0-9]{0,5}$";
    private static readonly Regex CustomSectionId = new Regex(@"\Acustom-[1-9][0-9]{0,5}\z", RegexOptions.CultureInvariant);
    private static readonly Regex Placeholder = new Regex(@"\[\[PII_[0-9]{4}\]\]", RegexOptions.CultureInvariant);
    private static readonly Regex Email = new Regex(@"[\w.%+-]+@[\w.-]+\.[\p{L}]{2,}", RegexOptions.CultureInvariant);
    private static readonly Regex WebLink = new Regex(@"(?:https?://|www\.)[^\s<>""'\[\]{}()]+", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static readonly Regex Phone = new Regex(@"(?<![\p{L}\p{N}])(?:\+[0-9]{8,15}|(?:\+[0-9]{1,3}[ .-]?)?(?:\([0-9]{2,4}\)[ .-]?|[0-9]{2,4}[ .-])[0-9]{3,4}[ .-]?[0-9]{4})(?![\p{L}\p{N}])", RegexOptions.CultureInvariant);
    private static readonly Regex Color = new Regex(@"^#[0-9a-fA-F]{6}$", RegexOptions.CultureInvariant);

    internal static JavaScriptSerializer Json()
    {
        return new JavaScriptSerializer { MaxJsonLength = Limit * 3, RecursionLimit = 32 };
    }

    internal static Dictionary<string, object> Object(object value)
    {
        var map = value as Dictionary<string, object>;
        if (map == null) throw new ArgumentException("Expected a JSON object.");
        return map;
    }

    internal static object Get(Dictionary<string, object> map, string key)
    {
        object value;
        return map.TryGetValue(key, out value) ? value : null;
    }

    internal static string StringValue(object value, int max)
    {
        var text = value as string;
        if (text == null || text.Length > max) throw new ArgumentException("A text field is missing or too long.");
        return text;
    }

    internal static void Keys(Dictionary<string, object> map, params string[] keys)
    {
        if (map.Keys.Any(key => !keys.Contains(key))) throw new ArgumentException("Unexpected fields. Send only the declared CV fields.");
    }

    private static string SafeText(object value, int limit)
    {
        var text = StringValue(value, limit * 12);
        if (Placeholder.Replace(text, "x").Length > limit)
            throw new ArgumentException("A CV text field is too long.");
        if (Email.IsMatch(text) || WebLink.IsMatch(text) || Phone.IsMatch(text))
            throw new ArgumentException("Replace contact details and web links with private placeholders.");
        return text;
    }

    private static object Choice(object value, params string[] choices)
    {
        if (!choices.Contains(value as string)) throw new ArgumentException("An unsupported option was selected.");
        return value;
    }

    private static object Number(object value, double minimum, double maximum)
    {
        if (!(value is int || value is long || value is decimal || value is double))
            throw new ArgumentException("Style values must be numeric.");
        double number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
        if (double.IsNaN(number) || number < minimum || number > maximum)
            throw new ArgumentException("A numeric style value is outside its allowed range.");
        return value;
    }

    private static IList List(object value, int max)
    {
        var list = value as IList;
        if (list == null || list.Count > max) throw new ArgumentException("An invalid list was provided.");
        return list;
    }

    internal static readonly string[] StyleKeys = {
        "accent", "textColor", "font", "density", "photoPosition", "headerAlignment", "rules",
        "fontSize", "spacing", "margin", "sectionOrder"
    };

    internal static Dictionary<string, object> Style(object value, bool partial)
    {
        var data = Object(value);
        Keys(data, StyleKeys);
        if (!partial && data.Count != StyleKeys.Length) throw new ArgumentException("The full appearance object is required.");
        foreach (var item in data)
        {
            switch (item.Key)
            {
                case "accent":
                case "textColor":
                    if (!Color.IsMatch(StringValue(item.Value, 7))) throw new ArgumentException("Colors must be #RRGGBB.");
                    break;
                case "font": Choice(item.Value, "sans", "serif", "humanist"); break;
                case "density": Choice(item.Value, "balanced", "compact", "spacious"); break;
                case "photoPosition": Choice(item.Value, "left", "right"); break;
                case "headerAlignment": Choice(item.Value, "left", "center"); break;
                case "rules": Choice(item.Value, "thin", "none", "heavy"); break;
                case "fontSize": Number(item.Value, 9, 13); break;
                case "spacing": Number(item.Value, .7, 1.5); break;
                case "margin": Number(item.Value, 10, 22); break;
                case "sectionOrder":
                    var sections = List(item.Value, Sections.Length + 1 + MaxCustomSections).Cast<object>().Select(x => x as string).ToArray();
                    var distinct = new HashSet<string>(sections);
                    if (sections.Length != 0 && (distinct.Count != sections.Length ||
                        !distinct.IsSupersetOf(Sections) || sections.Any(key => key == null ||
                            (!Sections.Contains(key) && key != "headline" && !CustomSectionId.IsMatch(key)))))
                        throw new ArgumentException("Section order must contain every standard section exactly once, with optional headline and custom sections.");
                    break;
            }
        }
        return data;
    }

    internal static Dictionary<string, object> Document(object value)
    {
        var doc = Object(value);
        Keys(doc, TextFields.Concat(Groups).Concat(new[] { "layout", "appearance", "customSections" }).ToArray());
        foreach (var field in TextFields) SafeText(Get(doc, field), field == "about" || field == "skills" ? 4000 : 250);
        Choice(Get(doc, "layout"), "technical", "experience");
        var style = Style(Get(doc, "appearance"), false);
        var customIds = new HashSet<string>();
        if (doc.ContainsKey("customSections"))
        {
            foreach (var item in List(doc["customSections"], MaxCustomSections))
            {
                var section = Object(item);
                Keys(section, "id", "title", "body");
                var id = StringValue(Get(section, "id"), 13);
                if (!CustomSectionId.IsMatch(id) || !customIds.Add(id))
                    throw new ArgumentException("Every custom section must have a unique ID.");
                SafeText(Get(section, "title"), 250);
                SafeText(Get(section, "body"), 4000);
            }
            if (customIds.Count == 0) doc.Remove("customSections");
        }
        if (((IList)style["sectionOrder"]).Cast<string>().Any(key => CustomSectionId.IsMatch(key) && !customIds.Contains(key)))
            throw new ArgumentException("Section order refers to a custom section outside the CV.");
        foreach (var group in Groups)
        {
            foreach (var valueRow in List(Get(doc, group), 50))
            {
                var row = Object(valueRow);
                if (group == "languages")
                {
                    Keys(row, LevelFields.Concat(new[] { "title" }).ToArray());
                    SafeText(Get(row, "title"), 250);
                    foreach (var level in LevelFields) Choice(Get(row, level), Levels);
                }
                else
                {
                    Keys(row, EntryFields);
                    foreach (var field in row.Keys) SafeText(row[field], field == "description" ? 4000 : 250);
                    if (row.Count != 4) throw new ArgumentException("Each entry needs all four text fields.");
                }
            }
        }
        return doc;
    }

    internal static Dictionary<string, object> Block(object value, Dictionary<string, object> original = null)
    {
        var block = Object(value);
        var fields = new HashSet<string>(block.Keys);
        if (original != null && !fields.SetEquals(original.Keys))
            throw new ArgumentException("Return exactly the fields in the queued block.");
        if (!(block.Count == 1 && TextFields.Contains(block.Keys.Single())) &&
            !fields.SetEquals(EntryFields) &&
            !fields.SetEquals(LevelFields.Concat(new[] { "title" })) &&
            !fields.SetEquals(new[] { "title", "body" }))
            throw new ArgumentException("The block has an unsupported field set.");

        foreach (var field in block)
        {
            if (LevelFields.Contains(field.Key)) Choice(field.Value, Levels);
            else SafeText(field.Value, new[] { "about", "skills", "description", "body" }.Contains(field.Key) ? 4000 : 250);
        }
        if (original != null) RequireSamePlaceholders(original, block);
        return block;
    }

    internal static string Instruction(object value)
    {
        var text = SafeText(value, 4000);
        if (String.IsNullOrWhiteSpace(text)) throw new ArgumentException("Enter a request before connecting an agent.");
        return text;
    }

    internal static string Note(object value)
    {
        return value == null ? "" : SafeText(value, 1000);
    }

    internal static void RequireSamePlaceholders(object before, object after)
    {
        var left = Placeholder.Matches(Json().Serialize(before)).Cast<Match>().Select(m => m.Value).OrderBy(x => x);
        var right = Placeholder.Matches(Json().Serialize(after)).Cast<Match>().Select(m => m.Value).OrderBy(x => x);
        if (!left.SequenceEqual(right)) throw new ArgumentException("Preserve every PII placeholder exactly, including repeated occurrences.");
    }
}
