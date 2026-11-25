# -*- coding: utf-8 -*-
"""Instructivo: Manejo completo de Arrendamientos en AgroCore (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Arrendamientos.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
IND_BG = colors.HexColor("#e0e7ff"); IND_BD = colors.HexColor("#818cf8"); IND_TX = colors.HexColor("#3730a3")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=20, textColor=G900, spaceAfter=2, leading=24)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_h3    = S("h3", fontName="Helvetica-Bold", fontSize=11.5, textColor=G900, spaceBefore=8, spaceAfter=3, leading=15)
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
    E.append(Paragraph("Manejo completo de Arrendamientos", st_title))
    E.append(Paragraph("Cargar el contrato, elegir la modalidad y pagar: efectivo, quintales, Kg Novillo, porcentaje y kilos a pizarra", st_sub))
    E.append(Paragraph(
        "En <b>Finanzas &rarr; Arrendamientos</b> cargás cada contrato de alquiler de campo con su <b>propietario</b>, las "
        "<b>hectáreas</b> y la <b>modalidad de pago</b>. Según la modalidad, el sistema valoriza lo que hay que pagar (a la "
        "cotización del día) y te deja ir registrando los pagos, que quedan reflejados en <b>Movimientos diarios</b> y en el "
        "<b>Flujo de Fondos</b>. Hay cinco modalidades; abajo se explican todas, con foco en la de <b>kilos de grano con venta "
        "mensual a precio pizarra</b>.", st_intro))
    E.append(callout("<b>Dato clave:</b> &nbsp; cada contrato tiene UNA modalidad. Elegila bien al cargarlo; podés editarla después, "
                     "pero conviene arrancar con la correcta para que las cuotas/ventas queden prolijas.", G100, G600, G900))

    E.append(Paragraph("Las 5 modalidades de pago", st_h2))
    data = [
        [Paragraph("<b>Modalidad</b>", st_step), Paragraph("<b>Cuándo usarla</b>", st_step)],
        [Paragraph("<b>Efectivo ($/ha)</b>", st_step), Paragraph("Monto fijo por hectárea, en pesos o dólares. Con o sin cuotas.", st_step)],
        [Paragraph("<b>Quintales de grano</b>", st_step), Paragraph("En especie: qq/ha en blanco y en negro. Se valoriza a pizarra del grano.", st_step)],
        [Paragraph("<b>Kg Novillo</b>", st_step), Paragraph("Kg de novillo por ha. Se valoriza al precio Cañuelas cargado en Cotizaciones.", st_step)],
        [Paragraph("<b>Porcentaje del rinde</b>", st_step), Paragraph("Un % de lo cosechado. Sin cuotas (depende del rinde real).", st_step)],
        [Paragraph("<b>Kilos de grano (venta mensual a pizarra)</b>", st_step), Paragraph("Total en kilos que el dueño va vendiendo por mes; cada venta se paga a pizarra del día, en entregas.", st_step)],
    ]
    t = Table(data, colWidths=[55*mm, 110*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),G100),("BOX",(0,0),(-1,-1),0.6,G600),
        ("INNERGRID",(0,0),(-1,-1),0.4,colors.HexColor("#bbf7d0")),
        ("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
    E.append(t)

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Cargar el contrato", st_h2))
    E.append(steps([
        "Entrá a <b>Finanzas &rarr; Arrendamientos</b> y tocá <b>+ Nuevo arrendamiento</b>.",
        "Poné el <b>Nombre del contrato</b> (ej. &ldquo;Campo Norte - Pérez 2026/27&rdquo;), el <b>Propietario</b> y, si querés, asociá un <b>Campo</b>.",
        "Cargá las <b>Hectáreas</b> y elegí la <b>Modalidad de pago</b>.",
        "Completá los campos que aparecen según la modalidad (importe/ha, qq/ha, etc.) y, si corresponde, las <b>cuotas</b> (cuánto y cuándo).",
        "Guardá. En la lista verás el contrato con su valor estimado a la cotización de hoy.",
    ]))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Pagar las cuotas (efectivo, quintales, Kg Novillo)", st_h2))
    E.append(steps([
        "En la lista, tocá el botón <b>&#128197; (cuotas)</b> del contrato.",
        "En cada cuota tocá <b>Pagar</b>: el sistema trae el <b>monto estimado</b> a la cotización del día (editalo si el pago real difiere).",
        "Elegí el <b>método</b>: efectivo, cheque, transferencia, débito o tarjeta, y la caja/cuenta/cheque según corresponda.",
        "Confirmá. La cuota queda <b>pagada</b> y el egreso se registra en <b>Movimientos diarios</b> (mueve la caja/banco/cheque real).",
    ]))
    E.append(callout("<b>Flujo de Fondos:</b> cada cuota de arrendamiento aparece <b>valorizada</b> en su fecha de vencimiento "
                     "(quintales a pizarra, Kg Novillo a Cañuelas, efectivo por su moneda), así planificás los pagos.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Modalidad KILOS DE GRANO (venta mensual a pizarra)", st_h2))
    E.append(Paragraph(
        "Es el caso del arreglo tipo: un total en kilos de soja que el dueño <b>va vendiendo por mes</b>, y el día que vende se "
        "mira el <b>precio pizarra</b> y se calcula cuánto pagarle. Además, ese pago no se hace de una sola vez: se hacen "
        "<b>varias entregas</b> sobre cada venta.", st_intro))

    E.append(Paragraph("3.1 &nbsp; Cargar el contrato en kilos", st_h3))
    E.append(steps([
        "Al crear el arrendamiento, en <b>Modalidad</b> elegí <b>&ldquo;Kilos de grano (venta mensual a pizarra)&rdquo;</b>.",
        "Cargá el <b>Grano</b> (ej. Soja), los <b>Kilos totales</b> del contrato (ej. 115.200), los <b>Kilos por mes</b> que vende según el arreglo (ej. 9.600) y el <b>Mes de inicio</b>.",
        "Guardá. El sistema <b>arma solo el plan de meses</b> (cada mes con sus kilos) y te abre la pantalla de <b>Ventas</b>.",
    ]))
    E.append(callout("<b>Plan vs. real:</b> el plan usa los kilos del arreglo (9.600). Si el dueño en realidad vende otra cantidad "
                     "(ej. 10.000), lo ajustás en la venta de ese mes. El plan es solo la guía.", G100, G600, G900))

    E.append(Paragraph("3.2 &nbsp; Registrar cada venta a pizarra", st_h3))
    E.append(steps([
        "En la lista del contrato, tocá <b>&#127807; Ventas</b>.",
        "Verás una fila por mes. Cuando el dueño vende, en ese mes cargá los <b>Kilos reales</b> vendidos y el <b>Precio pizarra ($/tonelada)</b> del día, y la <b>fecha de venta</b>.",
        "Tocá <b>&#128190; (guardar)</b> de esa fila. El sistema calcula el <b>importe a pagar</b> = kilos / 1000 &times; precio pizarra, y la venta pasa a <b>&ldquo;vendida - a pagar&rdquo;</b>.",
    ]))
    E.append(callout("<b>Ojo con la unidad:</b> la pizarra se carga en <b>pesos por TONELADA</b> (como figura en el ticker, ej. $535.000/t). "
                     "El sistema convierte los kilos a toneladas solo.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("3.3 &nbsp; Ir anotando las entregas (pagos parciales)", st_h3))
    E.append(steps([
        "En la fila de una venta ya valorizada, tocá <b>&#128181; Entrega</b>.",
        "Cargá el <b>importe de esa entrega ($)</b> y, si querés, los <b>kilos entregados</b> (dato informativo) de ese pago.",
        "Elegí el <b>método de pago</b> (efectivo, cheque, transferencia, débito, tarjeta) y la caja/cuenta/cheque.",
        "Registrá. La entrega <b>mueve la plata</b> a Movimientos diarios y <b>descuenta del saldo</b> de la venta. Repetí hasta saldar: cuando el saldo llega a 0, la venta queda <b>pagada</b>.",
    ]))
    E.append(callout("<b>Ejemplo:</b> vendió 10.000 kg a $500.000/t = $5.000.000 a pagar. Le hacés 3 entregas (ej. $2.000.000 + $2.000.000 + "
                     "$1.000.000) y en cada una podés anotar los kilos que le entregaste. El sistema lleva el saldo hasta que queda en cero.", IND_BG, IND_BD, IND_TX))
    E.append(bullets([
        "Cada entrega queda listada debajo de su venta, con fecha, método, importe y kilos.",
        "Si te equivocaste, tocá <b>deshacer</b> en la entrega: revierte el movimiento de plata y vuelve a sumar el saldo.",
        "Abajo de la tabla ves los <b>totales</b>: kilos, total a pagar y saldo pendiente de todo el contrato.",
    ]))

    E.append(Paragraph("3.4 &nbsp; Le pagaste de MÁS (cheque mayor) -&gt; saldo a favor", st_h3))
    E.append(Paragraph(
        "A veces le entregás un cheque por <b>más</b> de lo que figura ese mes: porque el cheque cubre también un mes "
        "anterior, o una venta que todavía no cargaste. No pasa nada: <b>cargala igual con el importe completo del cheque</b>. "
        "El excedente queda como <b>saldo a favor nuestro</b> y se descuenta solo de las próximas ventas.", st_intro))
    E.append(steps([
        "Registrá la entrega con el <b>importe real del cheque</b> (aunque sea mayor al saldo del mes).",
        "Arriba del todo, el arrendamiento muestra un <b>resumen global</b>: Total vendido, Entregado (plata) y, si pagaste "
        "de más, un <b>Saldo a favor nuestro</b> en verde.",
        "Cuando cargues la <b>siguiente venta</b>, el sistema ya le <b>resta</b> ese saldo a favor: el 'Falta pagar' viene "
        "con el descuento hecho. Recién pagás cuando se consume el saldo a favor.",
    ]))
    E.append(callout("<b>Ejemplo real:</b> el dueño vendió 15.000 kg (5.000 de la campaña anterior + 10.000 de la nueva) y le "
                     "diste UN cheque por todo. En el sistema tenías cargados solo los 10.000 kg. Cargás el cheque completo en "
                     "esa venta: el excedente (los 5.000 kg de más) queda como <b>saldo a favor</b>. Cuando cargues la próxima "
                     "venta (ej. $5.500.000), el sistema le resta ese saldo a favor y te dice que solo falta pagar la "
                     "diferencia. <b>Tip:</b> si esa venta anterior la tenías en un Excel, cargala también como venta del plan "
                     "para que el total cierre perfecto.", IND_BG, IND_BD, IND_TX))

    E.append(Paragraph("3.5 &nbsp; Saldo de la CAMPAÑA ANTERIOR (otro contrato)", st_h3))
    E.append(Paragraph(
        "El contrato se carga <b>uno por año / campaña</b>. A veces el dueño vende en una misma operación kilos de la "
        "campaña vieja + kilos de la nueva (ej. 5.000 kg que faltaban de la 25/26 + 10.000 kg de la 26/27). Para que todo "
        "cierre en un solo lugar, cargalos así:", st_intro))
    E.append(steps([
        "En el contrato NUEVO cargá el mes normal con sus kilos (ej. 10.000 kg) y su pizarra.",
        "Con el botón <b>&#10133; Venta manual (otra campaña / ajuste)</b> agregá una venta extra con los <b>5.000 kg</b> "
        "que faltaban, su pizarra, y una <b>etiqueta</b> que la identifique: ej. <b>&ldquo;Campaña 25/26 — saldo&rdquo;</b>.",
        "Registrá las entregas (los pagos) como siempre: el sistema suma todo y te muestra el saldo global (y el saldo a "
        "favor si pagaste de más). No hace falta cargar TODO el historial de la campaña vieja, solo los kilos que faltaban.",
    ]))
    E.append(callout("<b>Tip:</b> una venta manual sin entregas se puede <b>borrar</b> con el botón de la papelera. Y la "
                     "etiqueta deja bien claro que esos kilos son de la campaña anterior, aunque estén cargados en el "
                     "contrato nuevo.", IND_BG, IND_BD, IND_TX))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("El dueño vendió en una venta kilos de la campaña vieja y de la nueva. ¿Cómo los cargo?",
         "En el contrato nuevo cargá el mes normal y, con el botón 'Venta manual (otra campaña / ajuste)', agregá una venta extra con los kilos que quedaban de la campaña vieja y una etiqueta que lo identifique (ej. 'Campaña 25/26 - saldo'). Así el total cierra en un solo lugar y esos kilos quedan marcados como de la campaña anterior. Solo cargás los kilos que faltaban, no todo el historial."),
        ("Le entregué un cheque por más de lo que debía este mes. ¿Cómo lo cargo?",
         "Cargá la entrega con el importe completo del cheque, aunque sea mayor al saldo del mes. El excedente queda como 'Saldo a favor nuestro' (lo ves arriba, en verde) y se descuenta solo de las próximas ventas. No tenés que hacer nada más: cuando cargues la siguiente venta, el 'Falta pagar' ya viene restado."),
        ("Una venta de una campaña anterior la tenía en Excel. ¿Qué hago?",
         "Cargala también como una venta del plan (con sus kilos y su pizarra) para que el total del arrendamiento cierre. Así el saldo a favor y lo que falta pagar quedan exactos, sin tener que llevar nada aparte."),
        ("¿Puedo editar los kilos o el precio de una venta después?",
         "Sí. Entrá a Ventas, cambiá el valor y tocá guardar en esa fila. El importe y el saldo se recalculan solos."),
        ("¿Qué pasa si un mes no vende?",
         "Dejás esa fila sin precio (queda 'pendiente'). Cuando venda, cargás kilos y pizarra. No estás obligada a usar todos los meses del plan."),
        ("¿La entrega se anota en pesos o en kilos?",
         "La entrega es un importe en pesos (lo que realmente le pagás). Además podés anotar los kilos entregados como dato informativo, para tu control."),
        ("¿Las entregas afectan la caja o el banco?",
         "Sí. Cada entrega genera el egreso real en Movimientos diarios según el método (efectivo/cheque/banco). Por eso el saldo del sistema queda siempre al día."),
        ("¿Puedo tener este contrato y otros con otra modalidad al mismo tiempo?",
         "Sí. Cada contrato es independiente. Uno puede ser en kilos a pizarra, otro en quintales y otro en efectivo."),
        ("¿Dónde veo cuánto le pagué en total a un propietario?",
         "En la pantalla de Ventas del contrato: el pie de tabla muestra total a pagar y saldo. Cada egreso también queda en Movimientos diarios por fecha."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
