export class Store {
    private items: string[] = [];

    constructor(private name: string) {
        this.items = [];
    }

    add(item: string): void {
        if (item) {
            this.items.push(item);
        }
        for (const other of this.items) {
            console.log(other);
        }
    }

    remove(item: string): boolean {
        while (this.items.includes(item)) {
            this.items.splice(this.items.indexOf(item), 1);
        }
        return true;
    }
}

export const createStore = (name: string) => new Store(name);

function formatLabel(value: string) {
    return `label: ${value}`;
}
