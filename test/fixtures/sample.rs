pub struct Config {
    pub name: String,
}

impl Config {
    pub fn new(name: &str) -> Self {
        Config { name: name.to_string() }
    }

    fn merge<'a>(&self, other: &'a Config) -> String {
        if other.name.is_empty() {
            return self.name.clone();
        }
        other.name.clone()
    }
}

fn main() {
    let config = Config::new("x");
    println!("{}", config.name);
}
