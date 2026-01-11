#include <iostream>

struct User {
    std::string name;
};

int main() {
    User user{"Ada"};
    std::cout << user.name;
    return 0;
}
