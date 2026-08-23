public class Sample {
    private int count;

    public Sample(int count) {
        this.count = count;
    }

    public static void main(String[] args) {
        if (args.length > 0) {
            System.out.println(args[0]);
        }
    }

    private int total(int other) throws IllegalStateException {
        for (int i = 0; i < other; i++) {
            this.count += i;
        }
        return this.count;
    }
}
