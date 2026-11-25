# -*- coding: utf-8 -*-
"""Instructivo: Cliente que tambien es proveedor — Compensacion de cuentas (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Compensacion-Cliente-Proveedor.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=21, textColor=G900, spaceAfter=2, leading=25)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Cuando el cliente también es proveedor", st_title))
    E.append(Paragraph("Compensar cuentas: netear lo que te debe contra lo que le debes", st_sub))
    E.append(Paragraph(
        "A veces la misma persona te <b>compra</b> (es tu cliente) y además te <b>vende o te factura</b> "
        "(es tu proveedor). Ejemplo típico: un <b>fletero</b> te hace un flete y te lo factura, y en el mismo "
        "período te <b>compra un lechón</b> y se lo facturas. En AgroCore cada rol tiene su propia cuenta "
        "corriente: una <b>cuenta a cobrar</b> (lo que te debe como cliente) y una <b>cuenta a pagar</b> "
        "(lo que le debes como proveedor). La <b>compensación</b> cruza las dos y salda lo que coincide, "
        "sin que la plata dé vueltas.", st_intro))
    E.append(callout("<b>Importante:</b> la compensación <b>no mueve caja ni banco</b>. Es un cruce contable entre "
                     "las dos cuentas corrientes. La <b>diferencia</b> (si una es mayor que la otra) queda pendiente "
                     "para pagarla o cobrarla por el medio real.", AMBER_BG, AMBER_BD, AMBER_TX))
    E.append(Spacer(1, 3))

    E.append(Paragraph("Dónde se hace", st_h2))
    E.append(Paragraph("Menú <b>Comercial &rarr; Compensación de cuentas</b>.", st_intro))

    E.append(Paragraph("PARTE 1 &nbsp;&mdash;&nbsp; Decirle al sistema que es la misma persona", st_h2))
    E.append(Paragraph("Como cliente y proveedor son dos fichas distintas, primero hay que <b>vincularlas</b>. "
                       "Tenés dos caminos:", st_intro))
    E.append(Paragraph("<b>Opción A &mdash; Alta nueva con los dos roles</b>", st_intro))
    E.append(steps([
        "En <b>Compensación de cuentas</b>, toca <b>&#65291; Contacto (cliente y/o proveedor)</b>.",
        "Tilda <b>&ldquo;Es cliente&rdquo;</b> y <b>&ldquo;Es proveedor&rdquo;</b> (los dos).",
        "Carga los datos una sola vez (razón social, CUIT, etc.) y <b>Guardar</b>. Se crean las dos fichas ya vinculadas.",
    ]))
    E.append(Paragraph("<b>Opción B &mdash; Vincular fichas que ya existen</b>", st_intro))
    E.append(steps([
        "Toca <b>&#128279; Vincular cliente&harr;proveedor</b>.",
        "Elegí el <b>cliente</b> y el <b>proveedor</b> que son la misma persona y confirma <b>Vincular</b>.",
    ]))
    E.append(callout("<b>Tip:</b> conviene que el <b>CUIT</b> sea el mismo en las dos fichas. Así es más fácil "
                     "identificar que se trata de la misma persona.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PARTE 2 &nbsp;&mdash;&nbsp; Ver los dos saldos juntos", st_h2))
    E.append(Paragraph("Una vez vinculados, en <b>Compensación de cuentas</b> aparecen en la tabla "
                       "<b>&ldquo;Contactos vinculados con saldo compensable&rdquo;</b>, con tres números:", st_intro))
    E.append(bullets([
        "<b>Nos debe</b>: saldo de la cuenta a cobrar (lo que te debe como cliente).",
        "<b>Le debemos</b>: saldo de la cuenta a pagar (lo que le debes como proveedor).",
        "<b>Neto</b>: la diferencia entre ambos (positivo = te queda a favor; negativo = le quedás debiendo).",
    ]))

    E.append(Paragraph("PARTE 3 &nbsp;&mdash;&nbsp; Compensar (el cruce)", st_h2))
    E.append(steps([
        "En la fila del contacto, toca <b>&#128256; Compensar</b> (o el botón <b>Nueva compensación</b> y eligís el par).",
        "El sistema muestra <b>Nos debe</b>, <b>Le debemos</b> y el <b>Compensable</b> (el menor de los dos: es lo máximo que se puede cruzar).",
        "El <b>Monto a compensar</b> viene sugerido con el máximo; podés dejarlo o poner menos. Elegí la <b>fecha</b>.",
        "Toca <b>Compensar</b>. El sistema registra un <b>haber</b> en la cuenta del cliente y otro en la del "
        "proveedor por ese monto: ambos saldos bajan sin que salga ni entre plata.",
    ]))
    E.append(callout("<b>Qué pasa al guardar:</b> se saldan las dos cuentas por el monto compensado. "
                     "<b>No</b> se genera movimiento de efectivo, banco ni cheque.", G100, G600, G900))

    E.append(Paragraph("PARTE 4 &nbsp;&mdash;&nbsp; La diferencia", st_h2))
    E.append(Paragraph("Si lo que te debe y lo que le debes <b>no son iguales</b>, queda un remanente:", st_intro))
    E.append(bullets([
        "Si te <b>quedó debiendo</b> (le debes más): pagás la diferencia desde <b>Cuentas a pagar</b> por el medio real (efectivo, transferencia, cheque).",
        "Si te <b>quedó a favor</b> (te debe más): cobrás la diferencia desde <b>Cuentas a cobrar</b> por el medio real.",
    ]))
    E.append(Paragraph("Ejemplo: el flete fue $80.000 (le debes) y el lechón $50.000 (te debe). Compensás "
                       "<b>$50.000</b>: el lechón queda saldado y la deuda del flete baja a <b>$30.000</b>, que le "
                       "pagás normalmente.", st_intro))

    E.append(Paragraph("PARTE 5 &nbsp;&mdash;&nbsp; Comprobante y deshacer", st_h2))
    E.append(bullets([
        "Cada compensación queda en el <b>Historial</b>, con su número de referencia (COMP-...).",
        "Con el botón <b>&#129534; Comprobante</b> imprimís un <b>comprobante de compensación</b> para archivar o firmar con el contacto.",
        "Si te equivocaste, con <b>&#8617;&#65039; Deshacer</b> se borran los dos asientos y los saldos vuelven a quedar pendientes.",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿Esto cambia mis facturas o el IVA?",
         "No. Las facturas de venta y de compra siguen igual (cada una en su circuito y en el Libro IVA). La compensación solo cruza las cuentas corrientes; es la forma de saldarlas sin mover plata."),
        ("¿En qué moneda funciona?",
         "Por ahora la compensación trabaja en pesos (ARS). Si tenés deudas en dólares o en grano, esas se cancelan por su circuito habitual."),
        ("¿Puedo compensar solo una parte?",
         "Sí. Podés poner un monto menor al máximo compensable; el resto de cada cuenta queda pendiente."),
        ("¿Y si todavía no lo facturé?",
         "Primero carga la venta (factura al cliente) y la compra (factura del proveedor) para que existan los dos saldos. Recién ahí tiene sentido compensar."),
        ("¿Dónde veo lo que quedó pendiente después?",
         "En Cuentas a cobrar (lo que aún te debe) y en Cuentas a pagar (lo que aún le debes). La compensación ya descontó la parte cruzada."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
