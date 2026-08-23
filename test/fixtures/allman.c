#include <stdio.h>

int add(int a, int b)
{
    if (a > b)
    {
        return a + b;
    }
    return b + a;
}

int main(void)
{
    printf("%d\n", add(1, 2));
    return 0;
}
