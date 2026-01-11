using System;

public class User {
    public string Name { get; set; }
}

public class Program {
    public static void Main() {
        var user = new User { Name = "Ada" };
        Console.WriteLine(user.Name);
    }
}
