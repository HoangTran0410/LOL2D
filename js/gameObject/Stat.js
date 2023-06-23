export class StatModifier {
  constructor(baseValue = 0, baseBonus = 0, flatBonus = 0, percentBonus = 0, percentBaseBonus = 0) {
    this.baseValue = baseValue;
    this.baseBonus = baseBonus;
    this.flatBonus = flatBonus;
    this.percentBonus = percentBonus;
    this.percentBaseBonus = percentBaseBonus;
  }
}

export class Stat extends StatModifier {
  constructor(args) {
    super(args);
    this.value = this._calculateTotal();
  }

  addModifier(modifier) {
    if (!(modifier instanceof StatModifier)) return;
    this.baseValue += modifier.baseValue;
    this.baseBonus += modifier.baseBonus;
    this.flatBonus += modifier.flatBonus;
    this.percentBonus += modifier.percentBonus;
    this.percentBaseBonus += modifier.percentBaseBonus;

    this.value = this._calculateTotal();
  }

  removeModifier(modifier) {
    if (!(modifier instanceof StatModifier)) return;
    this.baseValue -= modifier.baseValue;
    this.baseBonus -= modifier.baseBonus;
    this.flatBonus -= modifier.flatBonus;
    this.percentBonus -= modifier.percentBonus;
    this.percentBaseBonus -= modifier.percentBaseBonus;

    this.value = this._calculateTotal();
  }

  _calculateTotal() {
    return (
      ((this.baseValue + this.baseBonus) * (1 + this.percentBaseBonus) + this.flatBonus) *
      (1 + this.percentBonus)
    );
  }
}
